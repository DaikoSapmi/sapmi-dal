FROM python:3.11-slim

WORKDIR /app

COPY update_sapmi_news_board.py /app/update_sapmi_news_board.py
COPY start_server.sh /app/start_server.sh
COPY web /app/web

RUN chmod +x /app/start_server.sh /app/update_sapmi_news_board.py

EXPOSE 8787

CMD ["/bin/sh", "-lc", "python3 /app/update_sapmi_news_board.py && /app/start_server.sh"]
