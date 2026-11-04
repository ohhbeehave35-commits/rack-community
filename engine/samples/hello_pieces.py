"""Sample recipe runner: three pieces, each saved before the next one starts.

Run by the actor through admission control. If it is stopped half way, starting it again
skips the pieces that were already saved and continues at the first one that was not.
"""
from rack_jobs import from_environment

PIECES = ['one', 'two', 'three']


def main():
    p = from_environment()
    p.plan(PIECES)
    for name in PIECES:
        p.run(name, lambda n=name: {'said': 'hello from piece ' + n})


if __name__ == '__main__':
    main()
