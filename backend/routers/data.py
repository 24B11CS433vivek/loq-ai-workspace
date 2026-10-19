import io
import json
import base64

import httpx
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from fastapi import APIRouter, UploadFile, File, Form, HTTPException

router = APIRouter(prefix="/tools/data", tags=["data"])

OLLAMA_URL = "http://localhost:11434"
# qwen2.5-coder is the strongest locally-installed model at emitting
# clean structured JSON; qwen3:4b is the fallback if it's unavailable
# or produces something unparseable (keeps this working even on a
# fresh install that only pulled the small default models).
PLANNER_MODEL = "qwen2.5-coder:7b"
PLANNER_MODEL_FALLBACK = "qwen3:4b"

# The LLM only ever chooses one of these operations — it never writes
# or runs pandas code itself. Everything below is executed by us
# against a whitelist of columns/operators/agg functions.
ALLOWED_OPS = {"describe", "filter", "groupby", "correlation"}
ALLOWED_FILTER_OPS = {"==", "!=", "<", "<=", ">", ">=", "contains"}
ALLOWED_AGG_FUNCS = {"mean", "sum", "count", "min", "max", "median"}
MAX_ROWS = 500  # cap rows returned/plotted — keeps payloads + charts sane


def _load_dataframe(filename: str, data: bytes) -> pd.DataFrame:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if ext == ".csv":
            return pd.read_csv(io.BytesIO(data))
        if ext in (".xlsx", ".xls"):
            return pd.read_excel(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse {filename}: {e}")
    raise HTTPException(status_code=400, detail=f"Unsupported data file type: {ext or 'unknown'}")


def _schema_summary(df: pd.DataFrame) -> dict:
    return {
        "columns": [{"name": str(c), "dtype": str(df[c].dtype)} for c in df.columns],
        "row_count": int(len(df)),
        "preview": json.loads(df.head(5).to_json(orient="records")),
    }


async def _plan_operation(question: str, schema: dict) -> dict:
    columns_desc = "\n".join(f"- {c['name']}: {c['dtype']}" for c in schema["columns"])
    prompt = f"""You are a data-analysis planner. You never write or run code — you only emit a single JSON object describing ONE safe operation to run against a pandas DataFrame.

Dataframe columns (name: dtype):
{columns_desc}

Row count: {schema['row_count']}
Sample rows: {json.dumps(schema['preview'])}

User question: "{question}"

Respond with ONLY a JSON object, no prose, no markdown fences, matching exactly one of these shapes:

1) {{"op": "describe"}}
2) {{"op": "filter", "filters": [{{"column": "<col>", "op": "<one of == != < <= > >= contains>", "value": <value>}}], "sort": {{"column": "<col>", "ascending": true}}, "limit": 200}}
3) {{"op": "groupby", "group_by": "<col>", "agg": {{"<col>": "<one of mean sum count min max median>"}}, "sort": {{"column": "<col>", "ascending": true}}}}
4) {{"op": "correlation", "columns": ["<col>", "..."]}}

Only use column names copied exactly from the list above. "sort" and "limit" are optional. Pick whichever operation best answers the question — e.g. a "who is below X%" question is a filter with a "<" comparison on the relevant column.

IMPORTANT — multiple conditions: the "filters" array is a LIST. When the question has more than one condition joined by "and"/"who also"/etc., put EACH condition as its OWN separate object in that list — they are combined with AND automatically. Do not merge two conditions into one filter object, and do not drop one of the conditions.

Example — question: "which remote employees have a performance score under 80":
{{"op": "filter", "filters": [{{"column": "remote", "op": "==", "value": "yes"}}, {{"column": "performance_score", "op": "<", "value": 80}}]}}

Example — question: "who is in Sales and earns over 60000":
{{"op": "filter", "filters": [{{"column": "department", "op": "==", "value": "Sales"}}, {{"column": "salary", "op": ">", "value": 60000}}]}}

IMPORTANT — counting rows: to count how many rows fall into each group (e.g. "how many students per grade", "count of employees by department"), use "groupby" with an EMPTY agg object — do NOT invent a fake column named "count". Only put a name in "agg" if it is a real column from the list above that you want to average/sum/etc.

Example — question: "how many students are in each grade":
{{"op": "groupby", "group_by": "grade", "agg": {{}}}}"""

    async with httpx.AsyncClient(timeout=45) as client:
        for model in (PLANNER_MODEL, PLANNER_MODEL_FALLBACK):
            try:
                res = await client.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={"model": model, "prompt": prompt, "stream": False, "format": "json"},
                )
                res.raise_for_status()
                raw = res.json().get("response", "").strip()
                spec = json.loads(raw)
                if isinstance(spec, dict) and spec.get("op") in ALLOWED_OPS:
                    return spec
            except Exception:
                continue
    # Safe default if planning failed on every model — still a valid,
    # side-effect-free operation the frontend can render.
    return {"op": "describe"}


def _validate_columns(df: pd.DataFrame, names):
    missing = [n for n in names if n and n not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown column(s): {missing}")


def _apply_filters(df: pd.DataFrame, filters):
    out = df
    for f in filters or []:
        col, op, val = f.get("column"), f.get("op"), f.get("value")
        if col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Unknown column: {col}")
        if op not in ALLOWED_FILTER_OPS:
            raise HTTPException(status_code=400, detail=f"Unsupported filter op: {op}")
        series = out[col]
        if op == "contains":
            out = out[series.astype(str).str.contains(str(val), case=False, na=False)]
            continue
        try:
            cmp_val = float(val)
            cmp_series = pd.to_numeric(series, errors="coerce")
        except (TypeError, ValueError):
            cmp_val = val
            cmp_series = series
        if op == "==":
            out = out[cmp_series == cmp_val]
        elif op == "!=":
            out = out[cmp_series != cmp_val]
        elif op == "<":
            out = out[cmp_series < cmp_val]
        elif op == "<=":
            out = out[cmp_series <= cmp_val]
        elif op == ">":
            out = out[cmp_series > cmp_val]
        elif op == ">=":
            out = out[cmp_series >= cmp_val]
    return out


def _apply_sort(df: pd.DataFrame, sort):
    if sort and sort.get("column") in df.columns:
        df = df.sort_values(sort["column"], ascending=bool(sort.get("ascending", True)))
    return df


def run_operation(df: pd.DataFrame, spec: dict) -> dict:
    op = spec.get("op")

    if op == "describe":
        stats = json.loads(df.describe(include="all").fillna("").to_json())
        return {
            "op": "describe",
            "row_count": int(len(df)),
            "columns": [{"name": str(c), "dtype": str(df[c].dtype)} for c in df.columns],
            "stats": stats,
            "preview": json.loads(df.head(10).to_json(orient="records")),
        }

    if op == "filter":
        _validate_columns(df, [f.get("column") for f in spec.get("filters", [])])
        result = _apply_filters(df, spec.get("filters", []))
        result = _apply_sort(result, spec.get("sort"))
        limit = min(int(spec.get("limit") or MAX_ROWS), MAX_ROWS)
        result = result.head(limit)
        return {
            "op": "filter",
            "matched": int(len(result)),
            "rows": json.loads(result.to_json(orient="records")),
        }

    if op == "groupby":
        group_col = spec.get("group_by")
        agg = spec.get("agg") or {}
        # The planner LLM sometimes answers a "how many per group" question
        # with {"agg": {"count": "count"}} -- using "count" as a stand-in
        # *column* name -- instead of the correct empty-agg shape that
        # triggers a plain row count. There is usually no real "count"
        # column, so that used to fail validation and abort the whole
        # analysis. Treat that placeholder the same as leaving agg empty
        # (a plain per-group row count) rather than erroring out.
        agg = {c: f for c, f in agg.items() if not (f == "count" and c not in df.columns)}
        _validate_columns(df, [group_col, *agg.keys()])
        bad_funcs = [f for f in agg.values() if f not in ALLOWED_AGG_FUNCS]
        if bad_funcs:
            raise HTTPException(status_code=400, detail=f"Unsupported agg function(s): {bad_funcs}")
        if not agg:
            grouped = df.groupby(group_col).size().reset_index(name="count")
        else:
            grouped = df.groupby(group_col).agg(agg).reset_index()
        grouped = _apply_sort(grouped, spec.get("sort"))
        grouped = grouped.head(MAX_ROWS)
        return {
            "op": "groupby",
            "group_by": group_col,
            "agg": agg,
            "rows": json.loads(grouped.to_json(orient="records")),
        }

    if op == "correlation":
        cols = spec.get("columns") or list(df.select_dtypes(include="number").columns)
        _validate_columns(df, cols)
        numeric = df[cols].apply(pd.to_numeric, errors="coerce")
        corr = numeric.corr().fillna(0)
        return {
            "op": "correlation",
            "columns": [str(c) for c in corr.columns],
            "matrix": json.loads(corr.to_json(orient="split"))["data"],
        }

    raise HTTPException(status_code=400, detail=f"Unsupported operation: {op}")


def _parse_operation_param(operation: str) -> dict:
    try:
        spec = json.loads(operation)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="`operation` must be valid JSON")
    if not isinstance(spec, dict) or spec.get("op") not in ALLOWED_OPS:
        raise HTTPException(status_code=400, detail=f"Unsupported op: {spec.get('op') if isinstance(spec, dict) else spec}")
    return spec


@router.post("/analyze")
async def analyze(file: UploadFile = File(...), question: str = Form(""), operation: str = Form("")):
    filename = file.filename or "upload"
    data = await file.read()
    df = _load_dataframe(filename, data)
    schema = _schema_summary(df)

    if operation:
        spec = _parse_operation_param(operation)
    elif question:
        spec = await _plan_operation(question, schema)
    else:
        spec = {"op": "describe"}

    result = run_operation(df, spec)
    return {"filename": filename, "schema": schema, "operation": spec, "result": result}


def _pick_chart(result: dict) -> bytes:
    op = result.get("op")
    fig, ax = plt.subplots(figsize=(7, 4.5), dpi=130)

    if op == "groupby":
        rows = result.get("rows", [])
        group_col = result.get("group_by")
        value_cols = [k for k in (rows[0].keys() if rows else []) if k != group_col]
        value_col = value_cols[0] if value_cols else None
        labels = [str(r.get(group_col)) for r in rows]
        values = [r.get(value_col) or 0 for r in rows] if value_col else [0] * len(rows)
        ax.bar(labels, values, color="#5b8def")
        ax.set_xlabel(group_col)
        ax.set_ylabel(value_col or "count")
        ax.set_title(f"{value_col or 'count'} by {group_col}")
        plt.xticks(rotation=40, ha="right")

    elif op == "filter":
        rows = result.get("rows", [])[:30]
        if not rows:
            ax.text(0.5, 0.5, "No matching rows", ha="center", va="center")
            ax.set_axis_off()
        else:
            numeric_cols = [k for k, v in rows[0].items() if isinstance(v, (int, float)) and not isinstance(v, bool)]
            label_col = next((k for k in rows[0] if k not in numeric_cols), list(rows[0].keys())[0])
            value_col = numeric_cols[0] if numeric_cols else None
            labels = [str(r.get(label_col)) for r in rows]
            values = [r.get(value_col) or 0 for r in rows] if value_col else [1] * len(rows)
            ax.bar(labels, values, color="#e0708c")
            ax.set_ylabel(value_col or "match")
            ax.set_xlabel(label_col)
            ax.set_title(f"Filtered results ({result.get('matched', len(rows))} matches)")
            plt.xticks(rotation=45, ha="right", fontsize=7)

    elif op == "correlation":
        cols = result.get("columns", [])
        matrix = result.get("matrix", [])
        im = ax.imshow(matrix, cmap="coolwarm", vmin=-1, vmax=1)
        ax.set_xticks(range(len(cols)))
        ax.set_yticks(range(len(cols)))
        ax.set_xticklabels(cols, rotation=45, ha="right", fontsize=8)
        ax.set_yticklabels(cols, fontsize=8)
        fig.colorbar(im, ax=ax, fraction=0.046)
        ax.set_title("Correlation matrix")

    elif op == "describe":
        cols = result.get("columns", [])
        stats = result.get("stats", {})
        names, means = [], []
        for c in cols:
            name = c["name"] if isinstance(c, dict) else c
            mean_val = stats.get(name, {}).get("mean")
            if isinstance(mean_val, (int, float)):
                names.append(name)
                means.append(mean_val)
        if names:
            ax.bar(names, means, color="#7bc67e")
            ax.set_title("Column means")
            plt.xticks(rotation=40, ha="right")
        else:
            ax.text(0.5, 0.5, "No numeric columns to chart", ha="center", va="center")
            ax.set_axis_off()

    else:
        ax.text(0.5, 0.5, "No chart available", ha="center", va="center")
        ax.set_axis_off()

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


@router.post("/chart")
async def chart(file: UploadFile = File(...), operation: str = Form(...)):
    filename = file.filename or "upload"
    data = await file.read()
    df = _load_dataframe(filename, data)
    spec = _parse_operation_param(operation)
    result = run_operation(df, spec)
    png_bytes = _pick_chart(result)
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return {"filename": filename, "operation": spec, "chart_type": result.get("op"), "image_base64": b64}
