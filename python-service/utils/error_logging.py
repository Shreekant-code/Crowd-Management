from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def install_error_handlers(app: FastAPI) -> None:
    logger = logging.getLogger(app.title)

    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, error: HTTPException) -> JSONResponse:
        logger.warning(
            "api_http_error method=%s path=%s status_code=%s detail=%s",
            request.method,
            request.url.path,
            error.status_code,
            error.detail,
        )
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": jsonable_encoder(error.detail)},
            headers=error.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        logger.warning(
            "api_validation_error method=%s path=%s errors=%s",
            request.method,
            request.url.path,
            error.errors(),
        )
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(error.errors())})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
        logger.exception(
            "api_unhandled_error method=%s path=%s",
            request.method,
            request.url.path,
            exc_info=error,
        )
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})
