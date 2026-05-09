from fastapi import APIRouter

router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

@router.post("/login")
async def login():
    return {"message": "Implement user login here"}

@router.post("/register")
async def register():
    return {"message": "Implement user registration here"}
