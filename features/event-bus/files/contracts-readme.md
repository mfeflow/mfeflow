# contracts

What the micro-frontends agree on, and nothing else. A remote never imports another remote; it
imports this.

- `src/events`: the events remotes publish and listen to, as types.
- `src/routes`: each remote's public paths, as plain data (added by `route-factory`).

Keep it to types and plain data with no imports, so reading it costs a remote nothing at run time
and it never pulls in another remote's code.
