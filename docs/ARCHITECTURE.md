# Architecture

```
 browser (panel)  --HTTP + X-Rack-Token-->  rack_api.py  --writes-->  jobs.sqlite3 (durable queue)
                                                |                              ^
                                                | reads                        | claims one job
                                                v                              |
                              HOLD, RACK-LIVE, STATUS, ADMISSIONS.md     rack_actor.py
                                                                               |  bash admit.sh --run  (memory admission)
                                                                               v
                                                              rack_supervisor.py -> recipe script
                                                                               |  Pieces.run(name, fn): saves each result
                                                                               v
                                                                       jobs/<id>/<piece>.json
```

## The engine files

| File | Job |
| --- | --- |
| `rack_jobs.py` | The queue (SQLite, `synchronous=FULL`) and the `Pieces` helper. Resume keys, a 60 s duplicate window, ordered atomic piece saves, deadlines that re-entry cannot extend. Standard library only. |
| `rack_actor.py` | The only thing that runs a job. One actor at a time (an OS lock inherited by the worker). Services controls first. Dry-run unless `RACK-LIVE` exists. Pause terminates the child's process group and keeps saved pieces. |
| `rack_supervisor.py` | Kills the whole process group when a piece overruns its limit or startup stalls, from outside the worker. |
| `admit.sh` | Memory admission control. One `flock` around check-and-record; entries are dropped only when the pid is gone. |
| `rack_recipes.py` | Loads and validates `recipes/*.json`; builds the fixed command for a recipe. |
| `rack_safety.py` | What may be requested (`validate_act`) and what must be refused before queueing (`start_refusal`). |
| `rack_system.py` | CPU, memory and GPU readings. A reading that cannot be taken is `null`, never `0`. |
| `rack_status_stream.py` | Cursor-based tail of the `STATUS` file for the Run status screen. |
| `rack_api.py` | The HTTP API. |

## HTTP API

| Method and path | Needs token | Purpose |
| --- | --- | --- |
| `GET /`, `/recipes`, `/system`, `/slivers`, `/activity`, `/admissions`, `/actions`, `/live` | no | Read state. |
| `GET /status`, `/status/stream` | yes | Memory figures and your `STATUS` log lines. |
| `POST /unlock` | yes | Checks the token; changes nothing. |
| `POST /live` | yes | Switch dry-run / LIVE. |
| `POST /preview` | yes | Would this recipe be admitted right now? Records nothing. |
| `POST /act` | yes | `pause`, `resume`, `stop`, `retry_job`, or a recipe name. Validated, refused if held or not admitted, then queued. |

## Files in the Rack folder (`RACK_DIR`)

`recipes/`, `samples/`, `peaks.conf` (yours); `jobs/` (queue and saved pieces), `ADMITTED.d/`, `ADMISSIONS.md`, `HOLD`, `RACK-LIVE`,
`STATUS`, `actions.log`, `actor.lock`, `admit.lock` (written by the Rack).
