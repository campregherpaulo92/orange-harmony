# Orange Harmony no Google Cloud Run
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMBA_NUM_THREADS=1 \
    MALLOC_ARENA_MAX=2

# libsndfile: leitura de áudio (o ffmpeg já vem junto do pacote imageio-ffmpeg)
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY frontend frontend

# o main.py serve a pasta ../frontend, então o servidor roda de dentro de /app/backend
WORKDIR /app/backend
# O Cloud Run informa a porta na variável PORT (8080)
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
