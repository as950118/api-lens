"""Tacet: check a TypeScript frontend against a Spring Boot API and explore change impact."""

from ._version import __version__
from .client import Tacet, TacetError

__all__ = ["Tacet", "TacetError"]
