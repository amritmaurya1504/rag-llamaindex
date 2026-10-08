# app/services/chunk_service.py

from dataclasses import dataclass
import re
from typing import List

import tiktoken


# =========================================================
# Data Models
# =========================================================

@dataclass
class PageText:
    page_number: int
    text: str


@dataclass
class TextBlock:
    text: str
    block_type: str
    start_page: int
    end_page: int


@dataclass
class Chunk:
    content: str
    section: str | None
    start_page: int
    end_page: int
    token_count: int
    block_types: List[str]


# =========================================================
# Tokenizer
# =========================================================

ENCODER = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    return len(ENCODER.encode(text))


# =========================================================
# Text Cleaning
# =========================================================

def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")

    # Remove excessive spaces
    text = re.sub(r"[ \t]+", " ", text)

    # Remove excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


# =========================================================
# Heading Detection
# =========================================================

def is_heading(line: str) -> bool:
    line = line.strip()

    if not line:
        return False

    # Don't consider very long lines headings
    if len(line) > 120:
        return False

    # List items are not headings
    if re.match(r"^[-•*]\s+", line):
        return False

    # Numbered headings
    #
    # Example:
    # 1. Introduction
    # 1.2 Eligibility
    # 2.3 Security
    if re.match(r"^\d+(\.\d+)*\.?\s+[A-Z]", line):
        return True

    # ALL CAPS headings
    letters = [char for char in line if char.isalpha()]

    if letters and all(char.isupper() for char in letters):
        return True

    # Short title-like lines
    if (
        len(line.split()) <= 10
        and not line.endswith(
            (".", "?", "!", ",", ";", ":")
        )
    ):
        return True

    return False


# =========================================================
# Extract Blocks
# =========================================================

def extract_blocks(
    pages: List[PageText],
) -> List[TextBlock]:

    blocks: List[TextBlock] = []

    current_lines: List[str] = []
    current_start_page = None
    current_end_page = None

    def flush_paragraph():

        nonlocal current_lines
        nonlocal current_start_page
        nonlocal current_end_page

        if not current_lines:
            return

        text = " ".join(
            line.strip()
            for line in current_lines
            if line.strip()
        )

        if text:

            blocks.append(
                TextBlock(
                    text=text,
                    block_type="paragraph",
                    start_page=current_start_page or 1,
                    end_page=current_end_page
                    or current_start_page
                    or 1,
                )
            )

        current_lines = []
        current_start_page = None
        current_end_page = None

    for page in pages:

        cleaned = clean_text(page.text)

        if not cleaned:
            continue

        lines = cleaned.split("\n")

        for raw_line in lines:

            line = raw_line.strip()

            if not line:
                flush_paragraph()
                continue

            # -------------------------
            # Heading
            # -------------------------

            if is_heading(line):

                flush_paragraph()

                blocks.append(
                    TextBlock(
                        text=line,
                        block_type="heading",
                        start_page=page.page_number,
                        end_page=page.page_number,
                    )
                )

                continue

            # -------------------------
            # List item
            # -------------------------

            if re.match(
                r"^([-•*]|\d+[.)])\s+",
                line,
            ):

                flush_paragraph()

                blocks.append(
                    TextBlock(
                        text=line,
                        block_type="list_item",
                        start_page=page.page_number,
                        end_page=page.page_number,
                    )
                )

                continue

            # -------------------------
            # Paragraph
            # -------------------------

            if current_start_page is None:
                current_start_page = page.page_number

            current_end_page = page.page_number

            current_lines.append(line)

    flush_paragraph()

    return blocks


# =========================================================
# Build Sections
# =========================================================

def build_sections(
    blocks: List[TextBlock],
):
    sections = []

    current_section = None
    current_blocks = []

    def flush_section():

        nonlocal current_blocks

        if current_blocks:

            sections.append(
                (
                    current_section,
                    current_blocks.copy(),
                )
            )

        current_blocks = []

    for block in blocks:

        if block.block_type == "heading":

            flush_section()

            current_section = block.text

        else:

            current_blocks.append(block)

    flush_section()

    return sections


# =========================================================
# Sentence Splitting
# =========================================================

def split_sentences(text: str) -> List[str]:

    sentences = re.split(
        r"(?<=[.!?])\s+(?=[A-Z0-9])",
        text,
    )

    return [
        sentence.strip()
        for sentence in sentences
        if sentence.strip()
    ]


# =========================================================
# Split Large Block
# =========================================================

def split_large_block(
    block: TextBlock,
    max_tokens: int,
) -> List[TextBlock]:

    if count_tokens(block.text) <= max_tokens:
        return [block]

    sentences = split_sentences(block.text)

    result = []

    current_sentences = []
    current_tokens = 0

    for sentence in sentences:

        sentence_tokens = count_tokens(sentence)

        # Extremely large sentence
        if sentence_tokens > max_tokens:

            if current_sentences:

                result.append(
                    TextBlock(
                        text=" ".join(current_sentences),
                        block_type=block.block_type,
                        start_page=block.start_page,
                        end_page=block.end_page,
                    )
                )

                current_sentences = []
                current_tokens = 0

            tokens = ENCODER.encode(sentence)

            for i in range(
                0,
                len(tokens),
                max_tokens,
            ):

                token_slice = tokens[
                    i:i + max_tokens
                ]

                result.append(
                    TextBlock(
                        text=ENCODER.decode(
                            token_slice
                        ),
                        block_type=block.block_type,
                        start_page=block.start_page,
                        end_page=block.end_page,
                    )
                )

            continue

        if (
            current_tokens + sentence_tokens
            > max_tokens
        ):

            result.append(
                TextBlock(
                    text=" ".join(
                        current_sentences
                    ),
                    block_type=block.block_type,
                    start_page=block.start_page,
                    end_page=block.end_page,
                )
            )

            current_sentences = []
            current_tokens = 0

        current_sentences.append(sentence)
        current_tokens += sentence_tokens

    if current_sentences:

        result.append(
            TextBlock(
                text=" ".join(current_sentences),
                block_type=block.block_type,
                start_page=block.start_page,
                end_page=block.end_page,
            )
        )

    return result


# =========================================================
# Build Final Chunk
# =========================================================

def build_chunk(
    blocks: List[TextBlock],
    section_name: str | None,
) -> Chunk:

    content = "\n\n".join(
        block.text
        for block in blocks
    )

    return Chunk(
        content=content,
        section=section_name,
        start_page=min(
            block.start_page
            for block in blocks
        ),
        end_page=max(
            block.end_page
            for block in blocks
        ),
        token_count=count_tokens(content),
        block_types=list(
            dict.fromkeys(
                block.block_type
                for block in blocks
            )
        ),
    )


# =========================================================
# Create Chunks
# =========================================================

def create_chunks(
    sections,
    target_tokens: int = 600,
    max_tokens: int = 800,
) -> List[Chunk]:

    chunks = []

    for section_name, blocks in sections:

        expanded_blocks = []

        for block in blocks:

            expanded_blocks.extend(
                split_large_block(
                    block,
                    max_tokens,
                )
            )

        current_blocks = []
        current_tokens = 0

        for block in expanded_blocks:

            block_tokens = count_tokens(
                block.text
            )

            if (
                current_blocks
                and
                current_tokens + block_tokens
                > max_tokens
            ):

                chunks.append(
                    build_chunk(
                        current_blocks,
                        section_name,
                    )
                )

                current_blocks = []
                current_tokens = 0

            current_blocks.append(block)

            current_tokens += block_tokens

            if current_tokens >= target_tokens:

                chunks.append(
                    build_chunk(
                        current_blocks,
                        section_name,
                    )
                )

                current_blocks = []
                current_tokens = 0

        if current_blocks:

            chunks.append(
                build_chunk(
                    current_blocks,
                    section_name,
                )
            )

    return chunks


# =========================================================
# MAIN FUNCTION
# =========================================================

def chunk_document(
    pages: List[PageText],
) -> List[Chunk]:

    blocks = extract_blocks(pages)

    sections = build_sections(blocks)

    chunks = create_chunks(
        sections,
        target_tokens=600,
        max_tokens=800,
    )

    return chunks