from __future__ import annotations

import tempfile
import pickle
import zipfile
from pathlib import Path
from typing import Any


def get_torch():
    try:
        import torch  # type: ignore

        return torch
    except Exception:
        return None


def get_torch_device() -> str:
    torch = get_torch()
    if torch is None:
        return "cpu"

    try:
        if torch.cuda.is_available():
            return "cuda:0"
    except Exception:
        pass

    return "cpu"


def resolve_artifact_path(current_file: str, artifact_name: str) -> Path:
    base_dir = Path(current_file).resolve().parent
    preferred = base_dir / artifact_name
    if preferred.exists():
        return preferred

    alternate_name = artifact_name[:-4] if artifact_name.endswith(".pth") else f"{artifact_name}.pth"
    alternate = base_dir / alternate_name
    if alternate.exists():
        return alternate

    return preferred


def _zip_directory(directory: Path) -> Path:
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_file.close()
    archive_path = Path(temp_file.name)

    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in directory.rglob("*"):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(directory).as_posix())

    return archive_path


def load_torch_module(current_file: str, artifact_name: str) -> tuple[Any, str | None]:
    torch = get_torch()
    if torch is None:
        return None, "torch_unavailable"
    device = get_torch_device()

    artifact_path = resolve_artifact_path(current_file, artifact_name)
    if not artifact_path.exists():
        return None, f"missing:{artifact_path.name}"

    sources: list[tuple[Any, Path | None]] = []
    if artifact_path.is_dir():
        archive_path = _zip_directory(artifact_path)
        sources.append((str(archive_path), archive_path))
    else:
        sources.append((str(artifact_path), None))

    last_error = "unknown_load_failure"
    for source, cleanup_path in sources:
        try:
            for loader_name in ("jit", "load"):
                try:
                    if hasattr(source, "seek"):
                        source.seek(0)

                    if loader_name == "jit":
                        model = torch.jit.load(source, map_location=device)
                    else:
                        model = torch.load(source, map_location=device, weights_only=False)

                    if isinstance(model, dict):
                        model = model.get("model") or model.get("module") or model

                    if hasattr(model, "to"):
                        model = model.to(device)
                    if hasattr(model, "eval"):
                        model.eval()

                    if callable(model):
                        return model, None
                except Exception as error:
                    last_error = str(error)
        finally:
            if cleanup_path is not None:
                cleanup_path.unlink(missing_ok=True)

    return None, last_error


def load_pickle(current_file: str, artifact_name: str) -> tuple[Any, str | None]:
    artifact_path = resolve_artifact_path(current_file, artifact_name)
    if not artifact_path.exists() or artifact_path.is_dir():
        return None, f"missing:{artifact_path.name}"

    try:
        with artifact_path.open("rb") as handle:
            return pickle.load(handle), None
    except Exception as error:
        return None, str(error)
