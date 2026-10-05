from fastapi import FastAPI, Request
import asyncio
import uvicorn

app = FastAPI()

@app.api_route("/test", methods=["GET", "POST"])
async def test_route(request: Request):
    if request.method == "POST":
        data = await request.json()
    else:
        data = dict(request.query_params)
    return {"method": request.method, "data": data}

if __name__ == "__main__":
    import threading
    import requests
    import time
    
    def run():
        uvicorn.run(app, host="127.0.0.1", port=8099)
    
    t = threading.Thread(target=run, daemon=True)
    t.start()
    time.sleep(2)
    
    print("GET:", requests.get("http://127.0.0.1:8099/test?keyword=hello&limit=10").json())
    print("POST:", requests.post("http://127.0.0.1:8099/test", json={"keyword": "world", "limit": 20}).json())
