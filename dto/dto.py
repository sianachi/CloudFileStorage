# DTO for registering a user
class RegisterUserRequest:
    username: str
    password: str
    email: str

class RegisterUserResponse:
    message: str

# DTO for logging in a user
class LoginUserRequest:
    username: str
    password: str

class LoginUserResponse:
    message: str