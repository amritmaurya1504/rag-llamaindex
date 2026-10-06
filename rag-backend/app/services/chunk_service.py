def chunk_text(
    text: str,
    chunk_size: int = 1000,
    overlap: int = 200
):
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = " ".join(
            words[start:end]
        )
        chunks.append(chunk)
        start = end - overlap
    return chunks


# 1000 / 200
# 800 / 100
# 500 / 50

# Problem with this it can split a sentence or section in the middle
# later i can implement structure-aware-chunking