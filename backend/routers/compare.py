"""Structured comparison across documents.

The capability this architecture makes possible that a plain chat-with-PDF tool
cannot do. Overlapping government schemes are exactly the case it serves.
"""
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

import config
import ratelimit
import retrieval
from auth import CurrentUser, get_current_user
from llm import smart_llm
from .prompts import FORMATTING_RULES
from .shared import CompareRequest, _document_name, _tidy_answer

logger = logging.getLogger("archivemind.querying")
router = APIRouter()


@router.post("/documents/compare")
def compare_documents(
    request: CompareRequest,
    http_request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    """Structured comparison across documents.

    This is the capability the architecture makes possible that a plain
    chat-with-PDF tool cannot do, and overlapping government schemes are
    exactly the case it serves.
    """
    # A comparison retrieves against every selected document and then runs a
    # long generation, so it is several times the cost of one chat message.
    ratelimit.enforce(
        "compare",
        ratelimit.client_key(http_request, user.username),
        config.COMPARE_RATE_LIMIT,
        config.COMPARE_RATE_WINDOW,
        message="You are running comparisons too quickly.",
    )

    doc_ids = [d for d in request.doc_ids if d][:3]
    if len(doc_ids) < 2:
        raise HTTPException(status_code=400, detail="Choose at least two documents to compare.")

    focus = request.focus.strip() or "objectives, eligibility, benefits, and obligations"

    sections = []
    all_citations: List[dict] = []
    offset = 0
    for doc_id in doc_ids:
        name = _document_name(doc_id)
        passages = retrieval.retrieve(focus, doc_id=doc_id, final_k=5, condense=False)
        if not passages:
            sections.append(f"### {name}\n(no relevant passages found)")
            continue
        numbered = [
            f"[{i}] {passage.text.strip()}"
            for i, passage in enumerate(passages, start=offset + 1)
        ]
        offset += len(passages)
        sections.append(f"### {name}\n" + "\n\n".join(numbered))
        for citation in retrieval.build_citations(passages):
            citation["n"] = len(all_citations) + 1
            all_citations.append(citation)

    if not all_citations:
        raise HTTPException(
            status_code=404,
            detail="No comparable content was found in those documents for that focus.",
        )

    compare_prompt = ChatPromptTemplate.from_messages([
        ("system",
         "You compare government policy documents for an analyst.\n"
         "Use ONLY the provided excerpts and cite every claim as [n].\n"
         "\n"
         "Structure the response exactly as these five sections:\n"
         "## Summary\n"
         "Two sentences on how these documents relate.\n"
         "\n"
         "## Side by side\n"
         "A markdown table: one row per attribute, one column per document.\n"
         "\n"
         "## Where they agree\n"
         "Bullets.\n"
         "\n"
         "## Where they differ\n"
         "Bullets. Be specific about which document says what.\n"
         "\n"
         "## Gaps\n"
         "What one covers that the others do not.\n"
         "\n"
         "THE TABLE IS THE PART THAT USUALLY COMES OUT BROKEN. Every row goes "
         "on its own line, with a real newline between rows - never one long "
         "line of pipes. Keep each cell under about 20 words; put the detail "
         "in the bullets below, not inside the table. Exactly this shape:\n"
         "\n"
         "| Attribute | Document A | Document B |\n"
         "| --- | --- | --- |\n"
         "| Objective | Short phrase [1] | Short phrase [2] |\n"
         "| Eligibility | Short phrase [1] | Not covered [2] |\n"
         "\n"
         "If the excerpts do not support a section, write 'Not covered in the "
         "provided excerpts.' rather than inventing content.\n"
         "\n"
         + FORMATTING_RULES),
        ("human", "Focus: {focus}\n\n{sections}"),
    ])

    try:
        chain = compare_prompt | smart_llm | StrOutputParser()
        comparison = _tidy_answer(
            chain.invoke({"focus": focus, "sections": "\n\n".join(sections)})
        )
    except Exception:
        logger.exception("Comparison failed")
        raise HTTPException(
            status_code=503,
            detail="The comparison could not be generated. Please try again shortly.",
        )

    return {
        "comparison": comparison,
        "citations": all_citations,
        "documents": [{"id": d, "filename": _document_name(d)} for d in doc_ids],
    }
