from importlib.resources import files
from pathlib import Path


def resource(directory, *parts):
    repository = Path(__file__).resolve().parents[2]
    shared = repository / directory
    if (repository / "python" / "setup.py").is_file() and shared.is_dir():
        return shared.joinpath(*parts)
    return files("mulebot").joinpath(directory, *parts)
