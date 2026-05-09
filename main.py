from services.filesystem import Filesystem
from models.file import File
from datetime import datetime
import os
from fastapi import FastAPI


working_directory_path = os.path.join(os.getcwd(), 'virtual-files')
app = FastAPI()

def __main__():
      filesystem = Filesystem(working_directory_path)

# Main logic - Init filesystem here with real path

__main__()
