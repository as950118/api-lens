"""ApiLens: check a TypeScript frontend against a Spring Boot API and explore change impact."""

from .client import ApiLens, ApiLensError

__all__ = ["ApiLens", "ApiLensError"]
__version__ = "0.1.0"
