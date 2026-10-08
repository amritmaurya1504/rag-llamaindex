from uuid import uuid4

from app.services.pdf_service import extract_pages
from app.services.chunk_service import chunk_document
from app.services.embedding_service import generate_embedding
from app.services.vector_service import (
    insert_chunk,
    search_similar_chunks,
)

from app.db.postgres import get_connection

from openai import OpenAI
from app.config import OPENAI_API_KEY


openai_client = OpenAI(
    api_key=OPENAI_API_KEY
)

def answer_question(question: str):
    question_embedding = generate_embedding(question)
    sources = search_similar_chunks(
        question_embedding,
        top_k=5
    )

    context = "\n\n".join(
        [
            f"""
SOURCE {index + 1}

File: {source["file"]}
Page: {source["page"]}

{source["text"]}
"""
            for index, source
            in enumerate(sources)
        ]
    )

    prompt = f"""
You are a document question-answering assistant.

Answer the user's question using ONLY the provided context.

Rules:

1. Do not use outside knowledge.
2. Do not invent information.
3. If the answer cannot be found in the context,
   say exactly:

"I don't know based on the provided context."

4. Cite sources using [1], [2], etc.
5. Only cite a source if it supports the statement.

Context:

{context}

Question:

{question}

Answer:
"""
    print(f"Context: "+ prompt)
    response = openai_client.responses.create(model="gpt-6-luna",input=prompt)
    return {
        "answer": response.output_text,
        "sources": sources
    }

def ingest_document(
    file_path: str,
    filename: str,
):

    document_id = str(uuid4())

    # -----------------------------------------
    # Create document
    # -----------------------------------------

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        INSERT INTO documents (
            id,
            filename,
            status
        )
        VALUES (
            %s,
            %s,
            %s
        )
        """,
        (
            document_id,
            filename,
            "processing",
        ),
    )

    conn.commit()

    cursor.close()
    conn.close()

    try:

        # -----------------------------------------
        # 1. Extract pages
        # -----------------------------------------

        pages = extract_pages(
            file_path
        )

        # -----------------------------------------
        # 2. Create semantic chunks
        # -----------------------------------------

        chunks = chunk_document(
            pages
        )

        # -----------------------------------------
        # 3. Generate embeddings + store
        # -----------------------------------------

        for chunk_index, chunk in enumerate(
            chunks
        ):

            print(
                f"\nCHUNK {chunk_index}"
            )

            print(
                f"Section: {chunk.section}"
            )

            print(
                f"Pages: "
                f"{chunk.start_page}-"
                f"{chunk.end_page}"
            )

            print(
                f"Tokens: "
                f"{chunk.token_count}"
            )

            embedding = generate_embedding(
                chunk.content
            )

            insert_chunk(
                document_id=document_id,
                filename=filename,
                start_page=chunk.start_page,
                end_page=chunk.end_page,
                chunk_index=chunk_index,
                content=chunk.content,
                embedding=embedding,
            )

        # -----------------------------------------
        # 4. Mark completed
        # -----------------------------------------

        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            UPDATE documents
            SET status = %s
            WHERE id = %s
            """,
            (
                "completed",
                document_id,
            ),
        )

        conn.commit()

        cursor.close()
        conn.close()

        return {
            "document_id": document_id,
            "filename": filename,
            "chunks": len(chunks),
            "status": "completed",
        }

    except Exception:

        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            UPDATE documents
            SET status = %s
            WHERE id = %s
            """,
            (
                "failed",
                document_id,
            ),
        )

        conn.commit()

        cursor.close()
        conn.close()

        raise