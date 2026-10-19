"""Content specifications shared between the planner and the renderers.

Three families of spec, one per output "shape". Splitting them (instead
of one generic title+paragraphs blob for every format) is what lets each
renderer produce something that actually looks like its format instead
of the same prose poured into different file extensions:

  ContentSpec -> narrative documents (docx, pdf, md, txt, html)
  SlideDeck   -> presentations (pptx)
  Workbook    -> tabular data (xlsx, csv)
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class TableBlock(BaseModel):
    headers: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)


class CodeBlock(BaseModel):
    language: str = ""
    content: str = ""
    caption: str = ""


class Section(BaseModel):
    heading: str = ""
    level: int = 1  # 1 = top-level heading, 2 = sub-heading
    paragraphs: list[str] = Field(default_factory=list)
    bullets: list[str] = Field(default_factory=list)
    numbered: bool = False
    table: Optional[TableBlock] = None
    code: Optional[CodeBlock] = None


class ContentSpec(BaseModel):
    title: str
    subtitle: str = ""
    sections: list[Section] = Field(default_factory=list)


class Slide(BaseModel):
    title: str = ""
    bullets: list[str] = Field(default_factory=list)
    notes: str = ""
    code: bool = False  # render bullets in monospace (attached source file preview)


class SlideDeck(BaseModel):
    title: str
    subtitle: str = ""
    slides: list[Slide] = Field(default_factory=list)


class Sheet(BaseModel):
    name: str = "Sheet1"
    headers: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)


class Workbook(BaseModel):
    title: str
    sheets: list[Sheet] = Field(default_factory=list)
