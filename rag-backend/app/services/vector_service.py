from app.db.postgres import get_connection


def insert_chunk(
    document_id,
    filename,
    page_number,
    chunk_index,
    content,
    embedding
):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO chunks (
            document_id,
            filename,
            page_number,
            chunk_index,
            content,
            embedding
        )
        VALUES (
            %s,
            %s,
            %s,
            %s,
            %s,
            %s
        )
        """,
        (
            document_id,
            filename,
            page_number,
            chunk_index,
            content,
            embedding
        )
    )
    conn.commit()
    cursor.close()
    conn.close()
    

def search_similar_chunks(
    embedding,
    top_k=5
):

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT
            id,
            filename,
            page_number,
            chunk_index,
            content,
            1 - (embedding <=> %s::vector) AS score
        FROM chunks
        ORDER BY embedding <=> %s::vector
        LIMIT %s
        """,
        (
            embedding,
            embedding,
            top_k
        )
    )
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": str(row[0]),
            "file": row[1],
            "page": row[2],
            "chunk_index": row[3],
            "text": row[4],
            "score": float(row[5])
        }
        for row in rows
    ]