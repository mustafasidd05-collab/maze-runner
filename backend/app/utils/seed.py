# =============================================================================
# utils/seed.py — Centralised seed management for deterministic maze generation
# =============================================================================

# random: Python's built-in PRNG module.
# - random.seed()        sets the GLOBAL generator state (affects all calls
#                        to random.choice, random.randint, etc.)
# - random.Random(seed)  creates an ISOLATED generator instance that does
#                        not share state with the global generator or other
#                        instances — recommended for services that run
#                        concurrently or in tests.
import random

# hashlib: provides stable, deterministic hash functions.
# Used to convert arbitrary strings into reproducible integer seeds.
# sha256 is chosen because it is available in all Python versions,
# produces a wide, well-distributed output, and never changes its
# algorithm between runs (unlike Python's built-in hash(), which is
# randomised per-process by PYTHONHASHSEED).
import hashlib

# logging: structured output instead of bare print() calls.
# Allows the host application to control log level, format, and destination
# without modifying this module.
import logging


# =============================================================================
# MODULE-LEVEL LOGGER
# Named after the module's dotted path so log output shows exactly where
# each message originated (e.g. "app.utils.seed").
# =============================================================================

logger: logging.Logger = logging.getLogger(__name__)


# =============================================================================
# CONSTANTS
# =============================================================================

# Upper bound (exclusive) used when folding a sha256 digest into an int.
# 2**32 keeps seeds in the unsigned 32-bit range — large enough to avoid
# collisions in practice while remaining compatible with every system that
# stores or transmits seeds as a standard integer.
_SEED_MODULUS: int = 2 ** 32


# =============================================================================
# 1. SET GLOBAL SEED
# =============================================================================

def set_global_seed(seed: int) -> None:
    """
    Set Python's process-wide random seed for fully deterministic behaviour.

    After calling this function, every subsequent call to `random.choice()`,
    `random.randint()`, `random.shuffle()`, etc. — anywhere in the process —
    will produce the same sequence for the same seed.

    When to use this vs create_rng()
    ---------------------------------
    Use `set_global_seed` when:
        - You control the entire process and know nothing else relies on
          the global PRNG (e.g. a single-threaded CLI script or a test
          that seeds once at the top).
        - You need quick, global reproducibility without passing an RNG
          instance through function arguments.

    Avoid it when:
        - Multiple services or threads share the process — one service
          calling set_global_seed will silently corrupt another service's
          random sequence.
        - You need isolated, independent random streams (use create_rng()).

    Args:
        seed: Integer seed value. The same seed always produces the same
              global random sequence. Negative integers are accepted by
              Python's random module.

    Raises:
        TypeError: If seed is not an integer.

    Example:
        >>> set_global_seed(42)
        >>> random.randint(0, 100)   # always the same value for seed=42
    """
    if not isinstance(seed, int):
        raise TypeError(
            f"Seed must be an integer, got {type(seed).__name__}. "
            "Convert the value before calling set_global_seed()."
        )

    random.seed(seed)
    logger.debug("Global random seed set to %d.", seed)


# =============================================================================
# 2. CREATE ISOLATED RNG INSTANCE
# =============================================================================

def create_rng(seed: int) -> random.Random:
    """
    Return an isolated `random.Random` instance seeded with `seed`.

    Unlike `set_global_seed()`, this creates a self-contained generator
    whose internal state is completely independent of:
        - Python's global random state
        - Any other `random.Random` instance created with a different seed
        - Concurrent requests or background tasks

    Why this is recommended for services
    -------------------------------------
    The maze generator, pathfinder, and any future service each get their
    own RNG instance. Calling `rng.choice()` on one instance has zero
    effect on another, making concurrent maze generation safe and
    reproducible regardless of request ordering.

        seed=42  →  rng_a = create_rng(42)   # isolated stream A
        seed=99  →  rng_b = create_rng(99)   # isolated stream B
        rng_a.choice([...])  # never affects rng_b

    Args:
        seed: Integer seed for the new generator instance.

    Returns:
        A fully seeded `random.Random` object ready for use.

    Raises:
        TypeError: If seed is not an integer.

    Example:
        >>> rng = create_rng(42)
        >>> rng.choice([1, 2, 3, 4])   # always the same value for seed=42
    """
    if not isinstance(seed, int):
        raise TypeError(
            f"Seed must be an integer, got {type(seed).__name__}. "
            "Convert the value before calling create_rng()."
        )

    rng: random.Random = random.Random(seed)
    logger.debug("Isolated RNG instance created with seed %d.", seed)
    return rng


# =============================================================================
# 3. DERIVE SEED FROM STRING
# =============================================================================

def get_seed_from_string(value: str) -> int:
    """
    Convert an arbitrary string into a stable, reproducible integer seed.

    Use cases
    ---------
    - A player types a memorable word ("dungeon", "labyrinth", "42abc")
      as a maze name and the backend needs a numeric seed.
    - URLs or query parameters carry a human-readable identifier that must
      map deterministically to a maze.
    - Test fixtures reference mazes by name rather than magic numbers.

    Why sha256 instead of hash()
    ----------------------------
    Python's built-in `hash()` is randomised per-process via PYTHONHASHSEED
    (a security feature introduced in Python 3.3). The same string will
    return a different integer on every run, making it useless for
    persistent, cross-session seeds.

    `hashlib.sha256` is a cryptographic hash with a fixed algorithm that
    produces identical output for identical input across:
        - Python versions
        - Operating systems
        - Process restarts
        - Different machines

    The 256-bit digest is folded into a 32-bit unsigned integer via modulo
    so the result fits comfortably in a standard `int` column and matches
    the range expected by `random.seed()`.

    Args:
        value: Any non-empty string. Unicode is encoded as UTF-8 before
               hashing so emoji, accented characters, etc. are handled
               correctly.

    Returns:
        A stable integer in [0, 2**32) derived from the input string.

    Raises:
        TypeError:  If value is not a string.
        ValueError: If value is an empty string (empty seeds are ambiguous
                    and usually a caller bug).

    Example:
        >>> get_seed_from_string("dungeon")
        2891336138          # always this exact value, on any machine
        >>> get_seed_from_string("dungeon") == get_seed_from_string("dungeon")
        True
    """
    if not isinstance(value, str):
        raise TypeError(
            f"Expected a string, got {type(value).__name__}. "
            "Only string values can be converted to seeds with this function."
        )

    if not value.strip():
        raise ValueError(
            "Cannot derive a seed from an empty or whitespace-only string. "
            "Provide a meaningful name or identifier."
        )

    # ── Hash the UTF-8 encoded string with sha256 ─────────────────────────
    # encode("utf-8") handles all Unicode characters safely.
    digest: str = hashlib.sha256(value.encode("utf-8")).hexdigest()

    # ── Convert the hex digest to an integer, then fold into 32-bit range ─
    # int(digest, 16) interprets the full 64-character hex string as a
    # base-16 number (up to ~1.16 × 10^77).
    # Modulo _SEED_MODULUS folds it into [0, 2**32) without losing
    # distribution quality — sha256 output is uniformly distributed.
    seed: int = int(digest, 16) % _SEED_MODULUS

    logger.debug(
        "String '%s' mapped to seed %d (sha256 prefix: %s…).",
        value,
        seed,
        digest[:8],   # log only the first 8 hex chars to keep logs tidy
    )
    return seed