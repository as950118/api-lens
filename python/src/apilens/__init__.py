"""ApiLens: check a TypeScript frontend against a Spring Boot API and explore change impact."""

from ._version import __version__
from .client import ApiLens, ApiLensError

__all__ = ["ApiLens", "ApiLensError"]
