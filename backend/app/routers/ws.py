from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.auth import verify_ws_token
from app.ws_manager import manager

router = APIRouter()


@router.websocket("/ws/events")
async def websocket_events(
    websocket: WebSocket,
    token: str = Query(None),
) -> None:
    if not token or verify_ws_token(token) is None:
        await websocket.close(code=4001, reason="Unauthorized")
        return
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        await manager.disconnect(websocket)
