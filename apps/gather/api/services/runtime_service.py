"""Runtime service compatibility layer."""

import api.services.runtime_chunk1 as _runtime_chunk1
import api.services.runtime_chunk2 as _runtime_chunk2
import api.services.runtime_chunk3 as _runtime_chunk3
import api.services.runtime_chunk4 as _runtime_chunk4
import api.services.runtime_chunk5 as _runtime_chunk5
import api.services.runtime_chunk6 as _runtime_chunk6

globals().update(vars(_runtime_chunk6))

# Backfill the final symbol table into every chunk module so functions
# defined in earlier chunks can resolve names that live in later chunks.
for _module in (
    _runtime_chunk1,
    _runtime_chunk2,
    _runtime_chunk3,
    _runtime_chunk4,
    _runtime_chunk5,
    _runtime_chunk6,
):
    _module.__dict__.update(globals())
