"""ToneModule P0 — FW Worker acoustic tone inference."""

__all__ = ["run_tone_inference"]


def __getattr__(name: str):
    if name == "run_tone_inference":
        from tone_module.inference import run_tone_inference

        return run_tone_inference
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
