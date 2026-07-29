FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src

ENV HOST=0.0.0.0 \
    PORT=8765

EXPOSE 8765

CMD ["python", "src/server.py"]
