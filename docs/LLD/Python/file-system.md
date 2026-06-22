# In-Memory File System — Low-Level Design (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[ood]` `[tree]` `[composite-pattern]` `[path-resolution]`
> **Language:** Python 3.10+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon, Microsoft, Google, Atlassian, Bloomberg, Dropbox

---

## Beginner's Guide

### What's this in plain English?

Build a Linux/macOS-style file system in memory. `mkdir`, `ls`, `touch`, `cat`, `echo > file`, navigate paths like `/a/b/c`. Files have content, directories have children. The whole thing is a tree.

### Why solve it?

- **Real world**: every file system, plus zip file content, JSON paths, S3 prefixes — same tree structure.
- **Teaches**: tree data structures, path parsing, the Composite pattern (file vs directory share an interface).
- **Interview**: classic LeetCode-meets-OOD.

### Vocabulary

- **Path** — `/a/b/c.txt`. Absolute starts with `/`.
- **Inode / Node** — a file system entry. Either a file (has content) or a directory (has children).
- **Composite pattern** — a tree where leaf and parent share the same interface.
- **Path resolution** — turning `/a/b/c` into a node by walking children.

### High-level approach

Entities:
- **Node** (abstract) — has name, parent, created/modified time.
- **File(Node)** — has content (string or bytes).
- **Directory(Node)** — has `dict[name → Node]`.
- **FileSystem** — the root + path operations.

Path resolution: split by `/`, walk children level by level. Validate each level exists.

Operations: `mkdir`, `ls`, `touch`, `read`, `write`, `delete`, `move`. `mkdir -p` creates intermediate dirs.

### How to read this doc

- **Beginner**: focus on the Node + path resolution.
- **Interview**: discuss permissions, symlinks, multi-user, byte-level vs line-level reads.

---

## 0. How to use this doc in an interview

File system is the **tree + path resolution** OOD interview. Tests:
1. Did you model files and directories with a **shared abstraction** (`Node`)?
2. Did you handle **path resolution** correctly — absolute, relative, `..`, `.`?
3. Did you cover the standard ops — `mkdir`, `ls`, `cat`, `cp`, `mv`, `rm`, plus `cd`?
4. Concurrency for shared FS?
5. Permissions (UNIX-style)?

Trap: not implementing `..`/`.`. Path resolution is the hidden trick — every senior interviewer asks for it.

---

## 1. Problem Statement

In-memory file system supporting:
- **Directories** (named, contain children).
- **Files** (named, contain bytes).
- **Path resolution** — absolute (`/a/b/c`), relative (`x/y`), with `.` and `..`.
- Standard ops: `mkdir`, `mkdir -p`, `ls`, `cat`, `write`, `append`, `cp`, `mv`, `rm`, `rm -r`.
- Optional: permissions, symlinks, current working directory.

---

## 2. Clarifying Questions

### Scope
- [ ] Just files + directories, or **symlinks**?
- [ ] Permissions (UNIX rwx) — yes/no?
- [ ] Hard links?
- [ ] Per-user / multi-tenant? (Default: single tenant.)
- [ ] CWD per-session, or global? (Per-session is more flexible.)
- [ ] What's the path separator? (`/` UNIX-style.)

### Domain
- [ ] What does `ls` return — names only, or with metadata?
- [ ] `cp` semantics: deep copy, shallow, or "by reference"? (Deep.)
- [ ] What's the **error model** — exceptions or `(value, error)`?
- [ ] File content type — `bytes` or `str`? (`bytes` is the truth; provide `str` convenience.)

### Non-functional
- [ ] Concurrency: single-thread or multi-thread? (Multi-thread; shared FS.)
- [ ] Persistence: in-memory only.
- [ ] Quotas / size limits?

> **For this doc:** files + directories (no symlinks), no permissions (designed-for), single tenant, per-session CWD, `/` separator, exceptions on errors, content as `bytes`, thread-safe via single tree-level lock.

---

## 3. Functional Requirements

**Must-have (P0):**
1. `mkdir(path, parents=False)` — create directory.
2. `touch(path)` — create empty file.
3. `write(path, content, append=False)` — set or append content.
4. `read(path) → bytes`.
5. `ls(path) → list[(name, type, size)]`.
6. `rm(path, recursive=False)`.
7. `cp(src, dst, recursive=False)`.
8. `mv(src, dst)` — atomic rename within FS.
9. `exists(path)` / `is_dir(path)` / `is_file(path)`.
10. Path resolution: absolute / relative / `.` / `..`.

**Should-have (P1):**
11. `Session` with CWD; `cd(path)`.
12. Sizes & timestamps (created, modified).

**Nice-to-have (P2 — designed):**
13. Symlinks.
14. Permissions (rwx + owner).
15. Hard links.
16. Locking / file watchers.
17. Persistence (snapshot to disk).

---

## 4. Actors & Use Cases

```
                    ┌──────────────────┐
                    │   File System    │
                    └──────────────────┘
                         ▲
                         │
                ┌────────┴───────┐
                │     Session    │  (per-user CWD, ops authenticated as that user)
                └────────────────┘
```

---

## 5. Core Entities

| Entity | Attributes | Notes |
|---|---|---|
| `Node` | name, parent, created_at, modified_at | Abstract base |
| `File` | content (bytes), size | leaf |
| `Directory` | children: dict[name → Node] | container |
| `FileSystem` | root, lock | facade |
| `Session` | fs, cwd, owner (future) | per-user view |

**Composite pattern:** Files and Directories share `Node`. Directories hold a map of `Node` (could be either type). `ls`, `rm -r`, `cp -r` traverse uniformly.

---

## 6. Class Diagram (ASCII)

```
                    ┌──────────────────────────┐
                    │       FileSystem         │
                    │──────────────────────────│
                    │ - root: Directory        │
                    │ - lock: RLock            │
                    │──────────────────────────│
                    │ + mkdir(path)            │
                    │ + write(path, data)      │
                    │ + read(path)             │
                    │ + ls(path)               │
                    │ + rm/cp/mv               │
                    └─────┬────────────────────┘
                          │ ◆
                          ▼
                    ┌──────────────────────┐
                    │ «abstract» Node      │
                    │──────────────────────│
                    │ - name, parent       │
                    │ - created_at         │
                    │ - modified_at        │
                    │──────────────────────│
                    │ + size() (abstract)  │
                    │ + path() string      │
                    └──────────▲───────────┘
                               │ extends
                ┌──────────────┼──────────────┐
                │                             │
        ┌──────────────┐               ┌──────────────────┐
        │     File     │               │   Directory      │
        │──────────────│               │──────────────────│
        │ - content    │               │ - children: dict │◆──┐
        │              │               │                  │   │
        └──────────────┘               └──────────────────┘   │
                                                              │
                                              recursive ◆ ◀───┘

  ┌──────────────────────┐
  │      Session         │
  │──────────────────────│
  │ - fs                 │
  │ - cwd: list[str]     │
  │──────────────────────│
  │ + cd(path)           │
  │ + ls(),  rm(), ...   │  delegates to fs with cwd-resolved path
  └──────────────────────┘
```

---

## 7. Design Patterns Used

| Pattern | Where | Why |
|---|---|---|
| Composite | `Node` ← `File`, `Directory`; Directory holds Node children | Uniform traversal of mixed structure |
| Facade | `FileSystem` exports the API | Hides traversal mechanics |
| Strategy (NOT used) | — | Could pluggable path resolution; overkill |
| Visitor (NOT used) | — | Recursive `rm/cp` via direct recursion is clearer |

---

## 8. Sequence Diagrams

### 8.1 mkdir -p /a/b/c

```
  User      FS              Directory(/a)   Directory(/a/b)
   │         │                  │                 │
   │── mk ──▶│── resolve(/a) ──▶│                │
   │         │── create b ─────────────────────▶  │   (created)
   │         │── create c ────────────────────────────▶ (created)
   │◀── ok ──│
```

### 8.2 cp -r /src /dst

```
  User      FS              Source       Target dir
   │         │                  │             │
   │── cp ──▶│── resolve(/src) ▶│             │
   │         │── resolve(/dst-parent) ───────▶│
   │         │── deep_copy ─────▶│            │
   │         │              ◀─── (clone) ─────│
   │◀── ok ──│
```

---

## 9. Concurrency Considerations

`FileSystem.lock` (RLock) protects all mutations. Reads (`ls`, `read`, `exists`) take RLock. Writes (`mkdir`, `write`, `rm`, `mv`) take WLock.

Tree-level lock is coarse but correct. Per-directory locks would scale better but require careful lock ordering (always parent-then-child to avoid deadlock).

---

## 10. Full Working Code

```python
"""
In-Memory File System — Low-Level Design (Python)

Features:
- Files and Directories with shared Node base
- Path resolution: absolute / relative / . / ..
- Standard ops: mkdir, touch, write, read, ls, rm, cp, mv
- Per-session CWD
- Thread-safe via tree-level RLock
"""
from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


SEP = "/"

# ──────────────────────────────────────────────────────────────────────────
# Errors
# ──────────────────────────────────────────────────────────────────────────

class FSError(Exception): ...
class NotFound(FSError): ...
class AlreadyExists(FSError): ...
class NotADir(FSError): ...
class NotAFile(FSError): ...
class NotEmpty(FSError): ...


# ──────────────────────────────────────────────────────────────────────────
# Nodes
# ──────────────────────────────────────────────────────────────────────────

class Node(ABC):
    def __init__(self, name: str, parent: Optional["Directory"] = None):
        self.name = name
        self.parent = parent
        now = datetime.utcnow()
        self.created_at = now
        self.modified_at = now

    @abstractmethod
    def size(self) -> int:
        ...

    def path(self) -> str:
        if self.parent is None:
            return SEP
        parts: list[str] = []
        node: Optional[Node] = self
        while node is not None and node.parent is not None:
            parts.append(node.name)
            node = node.parent
        return SEP + SEP.join(reversed(parts))


class File(Node):
    def __init__(self, name: str, parent: Optional["Directory"] = None, content: bytes = b""):
        super().__init__(name, parent)
        self.content: bytes = content

    def size(self) -> int:
        return len(self.content)

    def write(self, data: bytes, append: bool = False) -> None:
        if append:
            self.content = self.content + data
        else:
            self.content = data
        self.modified_at = datetime.utcnow()

    def read(self) -> bytes:
        return self.content


class Directory(Node):
    def __init__(self, name: str = "", parent: Optional["Directory"] = None):
        super().__init__(name, parent)
        self.children: dict[str, Node] = {}

    def size(self) -> int:
        return sum(c.size() for c in self.children.values())

    def add(self, node: Node) -> None:
        if node.name in self.children:
            raise AlreadyExists(f"{node.name} exists in {self.path()}")
        self.children[node.name] = node
        node.parent = self
        self.modified_at = datetime.utcnow()

    def remove(self, name: str) -> Node:
        if name not in self.children:
            raise NotFound(f"{name} not in {self.path()}")
        node = self.children.pop(name)
        node.parent = None
        self.modified_at = datetime.utcnow()
        return node


# ──────────────────────────────────────────────────────────────────────────
# Path utilities
# ──────────────────────────────────────────────────────────────────────────

def split_path(path: str) -> list[str]:
    """Return list of components, filtering empties and resolving . and ..
    Note: caller is responsible for distinguishing absolute (leading /) vs relative.
    """
    parts = [p for p in path.split(SEP) if p]
    # don't resolve . and .. here; that's the resolver's job
    return parts


# ──────────────────────────────────────────────────────────────────────────
# FileSystem
# ──────────────────────────────────────────────────────────────────────────

class FileSystem:
    def __init__(self) -> None:
        self.root = Directory(name="")  # name "" means root
        self._lock = threading.RLock()

    # ─── path resolution ─────────────────────────────────────────────

    def _resolve(self, path: str, cwd: list[str], must_exist: bool = True) -> Node:
        """Resolve a path to a Node. Returns the node if found.
        Path may be absolute (leading /) or relative; cwd is a list of dir names from root.
        Handles `.` (no-op) and `..` (parent)."""
        parts = self._normalize(path, cwd)
        node: Node = self.root
        for p in parts:
            if not isinstance(node, Directory):
                raise NotADir(f"{node.path()} is not a directory")
            if p not in node.children:
                if must_exist:
                    raise NotFound(f"{p} not in {node.path()}")
                # Returning current node + missing tail is the caller's problem
                # (most callers check existence first; for create operations, use _resolve_parent)
                raise NotFound(f"{p} not in {node.path()}")
            node = node.children[p]
        return node

    def _normalize(self, path: str, cwd: list[str]) -> list[str]:
        """Return absolute path components after resolving . and .."""
        if path.startswith(SEP):
            base: list[str] = []
            tail = path[len(SEP):]
        else:
            base = list(cwd)
            tail = path
        for p in tail.split(SEP):
            if p == "" or p == ".":
                continue
            if p == "..":
                if base:
                    base.pop()
            else:
                base.append(p)
        return base

    def _resolve_parent(self, path: str, cwd: list[str]) -> tuple[Directory, str]:
        """For create operations: split path into (parent_dir, leaf_name)."""
        parts = self._normalize(path, cwd)
        if not parts:
            raise FSError("cannot operate on root with this op")
        leaf = parts[-1]
        parent_path = SEP + SEP.join(parts[:-1])
        node = self._resolve(parent_path, cwd=[]) if parts[:-1] else self.root
        if not isinstance(node, Directory):
            raise NotADir(f"{node.path()} is not a directory")
        return node, leaf

    # ─── operations ─────────────────────────────────────────────────

    def mkdir(self, path: str, cwd: Optional[list[str]] = None, parents: bool = False) -> Directory:
        cwd = cwd or []
        with self._lock:
            parts = self._normalize(path, cwd)
            if not parts:
                raise AlreadyExists("/")
            node: Node = self.root
            for i, p in enumerate(parts):
                if isinstance(node, Directory) and p in node.children:
                    node = node.children[p]
                    if i == len(parts) - 1:
                        raise AlreadyExists(node.path())
                    continue
                if not parents and i < len(parts) - 1:
                    raise NotFound(f"intermediate {p} missing; pass parents=True")
                if not isinstance(node, Directory):
                    raise NotADir(f"{node.path()} is not a directory")
                d = Directory(name=p)
                node.add(d)
                node = d
            return node  # type: ignore[return-value]

    def touch(self, path: str, cwd: Optional[list[str]] = None) -> File:
        cwd = cwd or []
        with self._lock:
            parent, name = self._resolve_parent(path, cwd)
            if name in parent.children:
                node = parent.children[name]
                if isinstance(node, File):
                    return node
                raise AlreadyExists(f"{name} exists as directory")
            f = File(name=name)
            parent.add(f)
            return f

    def write(self, path: str, data: bytes, *, append: bool = False, cwd: Optional[list[str]] = None) -> None:
        cwd = cwd or []
        with self._lock:
            try:
                node = self._resolve(path, cwd)
                if not isinstance(node, File):
                    raise NotAFile(f"{path} is not a file")
                node.write(data, append=append)
            except NotFound:
                # auto-create
                f = self.touch(path, cwd)
                f.write(data, append=False)

    def read(self, path: str, cwd: Optional[list[str]] = None) -> bytes:
        cwd = cwd or []
        with self._lock:
            node = self._resolve(path, cwd)
            if not isinstance(node, File):
                raise NotAFile(f"{path} is not a file")
            return node.read()

    def ls(self, path: str = "/", cwd: Optional[list[str]] = None) -> list[tuple[str, str, int]]:
        """Return list of (name, type, size) sorted alphabetically."""
        cwd = cwd or []
        with self._lock:
            node = self._resolve(path, cwd)
            if isinstance(node, File):
                return [(node.name, "file", node.size())]
            assert isinstance(node, Directory)
            return sorted(
                (n, "dir" if isinstance(c, Directory) else "file", c.size())
                for n, c in node.children.items()
            )

    def rm(self, path: str, *, recursive: bool = False, cwd: Optional[list[str]] = None) -> None:
        cwd = cwd or []
        with self._lock:
            parent, name = self._resolve_parent(path, cwd)
            if name not in parent.children:
                raise NotFound(f"{path} does not exist")
            node = parent.children[name]
            if isinstance(node, Directory) and node.children and not recursive:
                raise NotEmpty(f"{path} is a non-empty directory; pass recursive=True")
            parent.remove(name)

    def cp(self, src: str, dst: str, *, recursive: bool = False, cwd: Optional[list[str]] = None) -> None:
        cwd = cwd or []
        with self._lock:
            src_node = self._resolve(src, cwd)
            if isinstance(src_node, Directory) and not recursive:
                raise FSError(f"{src} is a directory; pass recursive=True")
            # decide destination
            try:
                dst_node = self._resolve(dst, cwd)
                if isinstance(dst_node, Directory):
                    parent = dst_node
                    leaf = src_node.name
                    if leaf in parent.children:
                        raise AlreadyExists(f"{leaf} exists in {dst}")
                else:
                    raise FSError(f"{dst} exists and is not a directory")
            except NotFound:
                parent, leaf = self._resolve_parent(dst, cwd)
            clone = self._deep_copy(src_node, leaf)
            parent.add(clone)

    def mv(self, src: str, dst: str, *, cwd: Optional[list[str]] = None) -> None:
        cwd = cwd or []
        with self._lock:
            src_parent, src_leaf = self._resolve_parent(src, cwd)
            if src_leaf not in src_parent.children:
                raise NotFound(f"{src} does not exist")
            src_node = src_parent.children[src_leaf]
            try:
                dst_node = self._resolve(dst, cwd)
                if isinstance(dst_node, Directory):
                    new_parent = dst_node
                    new_leaf = src_leaf
                    if new_leaf in new_parent.children:
                        raise AlreadyExists(new_leaf)
                else:
                    raise FSError(f"{dst} exists and is not a directory")
            except NotFound:
                new_parent, new_leaf = self._resolve_parent(dst, cwd)
            # detach + re-attach
            src_parent.remove(src_leaf)
            src_node.name = new_leaf
            new_parent.add(src_node)

    def exists(self, path: str, cwd: Optional[list[str]] = None) -> bool:
        cwd = cwd or []
        with self._lock:
            try:
                self._resolve(path, cwd)
                return True
            except NotFound:
                return False

    def is_dir(self, path: str, cwd: Optional[list[str]] = None) -> bool:
        cwd = cwd or []
        try:
            with self._lock:
                node = self._resolve(path, cwd)
                return isinstance(node, Directory)
        except NotFound:
            return False

    def is_file(self, path: str, cwd: Optional[list[str]] = None) -> bool:
        cwd = cwd or []
        try:
            with self._lock:
                node = self._resolve(path, cwd)
                return isinstance(node, File)
        except NotFound:
            return False

    # ─── helpers ────────────────────────────────────────────────────

    def _deep_copy(self, node: Node, new_name: str) -> Node:
        if isinstance(node, File):
            f = File(name=new_name, content=node.content)
            return f
        assert isinstance(node, Directory)
        d = Directory(name=new_name)
        for child_name, child in node.children.items():
            clone = self._deep_copy(child, child_name)
            d.add(clone)
        return d


# ──────────────────────────────────────────────────────────────────────────
# Session (per-user CWD)
# ──────────────────────────────────────────────────────────────────────────

class Session:
    def __init__(self, fs: FileSystem) -> None:
        self.fs = fs
        self.cwd: list[str] = []

    def cd(self, path: str) -> None:
        new = self.fs._normalize(path, self.cwd)
        # validate it's an existing directory
        if new and not self.fs.is_dir(SEP + SEP.join(new)):
            raise NotFound(f"{path} not a directory")
        self.cwd = new

    def pwd(self) -> str:
        return SEP + SEP.join(self.cwd)

    # delegators
    def mkdir(self, p, parents=False): return self.fs.mkdir(p, self.cwd, parents)
    def touch(self, p): return self.fs.touch(p, self.cwd)
    def write(self, p, data, append=False): return self.fs.write(p, data, append=append, cwd=self.cwd)
    def read(self, p): return self.fs.read(p, self.cwd)
    def ls(self, p="."): return self.fs.ls(p, self.cwd)
    def rm(self, p, recursive=False): return self.fs.rm(p, recursive=recursive, cwd=self.cwd)
    def cp(self, s, d, recursive=False): return self.fs.cp(s, d, recursive=recursive, cwd=self.cwd)
    def mv(self, s, d): return self.fs.mv(s, d, cwd=self.cwd)


# ──────────────────────────────────────────────────────────────────────────
# Tests / demo
# ──────────────────────────────────────────────────────────────────────────

def _basic() -> None:
    print("--- basic mkdir/touch/write/read/ls ---")
    fs = FileSystem()
    fs.mkdir("/a")
    fs.mkdir("/a/b")
    fs.write("/a/b/c.txt", b"hello")
    assert fs.read("/a/b/c.txt") == b"hello"
    fs.write("/a/b/c.txt", b" world", append=True)
    assert fs.read("/a/b/c.txt") == b"hello world"
    listing = fs.ls("/a/b")
    assert ("c.txt", "file", 11) in listing
    print("  OK")


def _path_resolution() -> None:
    print("--- path resolution (. and ..) ---")
    fs = FileSystem()
    fs.mkdir("/a/b/c", parents=True)
    fs.write("/a/file.txt", b"x")
    assert fs.exists("/a/b/c")
    assert fs.exists("/a/b/c/../../file.txt")
    s = Session(fs)
    s.cd("/a/b")
    assert s.pwd() == "/a/b"
    s.cd("../")
    assert s.pwd() == "/a"
    assert s.read("file.txt") == b"x"
    s.cd("/a/b/c/../..")
    assert s.pwd() == "/a"
    print("  OK")


def _mkdir_p() -> None:
    print("--- mkdir -p ---")
    fs = FileSystem()
    fs.mkdir("/x/y/z", parents=True)
    assert fs.is_dir("/x/y/z")
    try:
        fs.mkdir("/x/y/z")  # already exists
        assert False
    except AlreadyExists:
        pass
    try:
        fs.mkdir("/q/r/s")  # missing intermediate
        assert False
    except NotFound:
        pass
    print("  OK")


def _rm_tests() -> None:
    print("--- rm with/without recursive ---")
    fs = FileSystem()
    fs.mkdir("/a/b", parents=True)
    fs.write("/a/b/file", b"x")
    try:
        fs.rm("/a")
        assert False
    except NotEmpty:
        pass
    fs.rm("/a", recursive=True)
    assert not fs.exists("/a")
    print("  OK")


def _cp_mv() -> None:
    print("--- cp/mv ---")
    fs = FileSystem()
    fs.mkdir("/src/sub", parents=True)
    fs.write("/src/file.txt", b"hi")
    fs.write("/src/sub/inner.txt", b"deep")
    fs.mkdir("/dst")
    fs.cp("/src", "/dst", recursive=True)
    assert fs.read("/dst/src/file.txt") == b"hi"
    assert fs.read("/dst/src/sub/inner.txt") == b"deep"
    # mv
    fs.mv("/src/file.txt", "/src/renamed.txt")
    assert not fs.exists("/src/file.txt")
    assert fs.read("/src/renamed.txt") == b"hi"
    print("  OK")


def _concurrent_safe() -> None:
    print("--- concurrent mkdir burst ---")
    fs = FileSystem()
    fs.mkdir("/parent")
    errors = []
    def fire(i: int):
        try:
            fs.mkdir(f"/parent/d{i}")
        except FSError as e:
            errors.append(str(e))
    threads = [threading.Thread(target=fire, args=(i,)) for i in range(50)]
    for t in threads: t.start()
    for t in threads: t.join()
    listing = fs.ls("/parent")
    assert len(listing) == 50, f"got {len(listing)}"
    assert not errors
    print("  OK; created 50 dirs concurrently")


def _session() -> None:
    print("--- session CWD ---")
    fs = FileSystem()
    s = Session(fs)
    s.mkdir("/home/sarya/work", parents=True)
    s.cd("/home/sarya")
    s.write("notes.txt", b"todo")
    assert s.read("notes.txt") == b"todo"
    assert s.read("./notes.txt") == b"todo"
    assert s.pwd() == "/home/sarya"
    s.cd("..")
    assert s.pwd() == "/home"
    print("  OK")


if __name__ == "__main__":
    _basic()
    _path_resolution()
    _mkdir_p()
    _rm_tests()
    _cp_mv()
    _concurrent_safe()
    _session()
    print("\nAll tests passed.")
```

### How to run

```bash
python3 ~/Downloads/cc/kb/LLD/Python/file-system.py
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why a shared `Node` base for `File` and `Directory`?

Composite pattern. Operations like `rm -r` and `cp -r` need to traverse a tree of mixed types uniformly. With a shared base, `Directory.children` holds `Node` and recursion is clean. Without it, every traversal needs `isinstance` branches in 5 places.

### 11.2 Why `dict[name → Node]` for children and not `list`?

`dict` gives O(1) lookup and uniqueness enforcement. `ls` is `dict.items()`; `mkdir` checks `name in children`. With a list, `mkdir` is O(N) per check, `rm` is O(N) per removal.

For ordered display (`ls` sorted alphabetically), we sort at query time. The dict's insertion-order in Py3.7+ doesn't help us.

### 11.3 Why `bytes` content and not `str`?

Files hold bytes — that's the OS truth. Text is a convention layered on top (with an encoding). Forcing `str` would require us to pick UTF-8 (and break for binary files). Callers can `.decode()` for text.

### 11.4 Why a single `RLock` and not per-directory locks?

Tree mutations span multiple directories (`mv` touches src parent and dst parent). Per-directory locks need careful ordering to avoid deadlock (always parent-then-child? alphabetical? hierarchical?).

A single tree-lock is simpler and correct. For 1k+ concurrent ops, switch to fine-grained.

### 11.5 Why is `_resolve` private and `_normalize` separate from it?

`_resolve` returns the node; `_normalize` returns the components. Some operations (mkdir) need to walk components creating along the way — they can't use `_resolve` (it requires existence). Splitting the path-component logic from node-traversal makes both reusable.

### 11.6 Why does `_normalize` handle `..` here instead of in path lib?

We could use `os.path.normpath`, but its behavior is OS-dependent (different on Windows). Implementing `..` resolution explicitly:
- Portable.
- Testable.
- Exposes the algorithm.

### 11.7 Why does `cp` handle "destination is a directory" specially?

UNIX `cp src dst` semantics: if `dst` is an existing directory, `src` is copied *into* `dst` as a child. If `dst` doesn't exist, `dst` is the new name.

Our code mirrors this: try to resolve `dst`; if it's a dir, copy as `dst/<src.name>`; if it doesn't exist, copy as `dst`'s leaf.

### 11.8 Why does `write` auto-create?

UNIX `>` redirect creates the file if missing. `write_text` in pathlib does the same. We follow the convention.

If the caller wants strict create-or-fail, they call `touch` first explicitly.

### 11.9 What about symlinks?

Add `Symlink` as a Node subclass with a `target_path`. On resolve, if a Symlink is encountered mid-path, recursively resolve its target with a depth limit (to detect loops).

Out of scope for base design; clean addition.

### 11.10 What about permissions?

Add `mode: int` and `owner: str` to `Node`. Each operation checks (e.g. `write` requires `w` for the user). `Session` carries the user identity.

UNIX-style modes are well-understood. Out of scope here.

### 11.11 Why does `Directory.size()` recurse?

UNIX-like. `ls -l` of a directory shows the size as the directory entry itself (small constant); `du` shows recursive size. We chose the recursive sum for `size()` because it's more useful for "how big is this subtree" — and a constant `4096` for directory entries is misleading.

We could return both: `size()` and `recursive_size()`. Out of scope minimization.

### 11.12 Why doesn't `Directory.add` check for cycles?

A cycle would require `node.parent` to eventually loop back to `node`. We never construct that — `add` always creates a fresh Node or moves an existing one with a known parent. If extended to support symlinks or arbitrary references, a cycle check is needed.

### 11.13 What's the failure mode if `mv` fails mid-operation?

`mv` does `src_parent.remove + new_parent.add`. If `add` raises (e.g. AlreadyExists), the node is left dangling — removed from src, not in dst.

Fix: re-add to src_parent on failure. A try/except wrap. We don't here for clarity; production-grade would.

### 11.14 Why does `ls` return `(name, type, size)` tuples and not `Node` objects?

API surface boundary. Returning Node would expose internal types (callers could mutate `node.parent`). Returning tuples is read-only and serializable.

For richer queries, a separate `stat(path) → dict` returns metadata.

### 11.15 What if I want streaming reads (large files)?

Add `read_chunk(path, offset, n) → bytes`. The internal representation could move from `bytes` to `bytearray` or even a chunk-list for large files. Out of scope.

### 11.16 Why is `File.write` not appending to a single buffer?

For simplicity. `bytes` is immutable in Python, so `content + data` allocates. For large append-heavy workloads, switch to `bytearray` and mutate in-place — saves O(N) allocations.

---

## 12. Extensions

### 12.1 Symlinks
`Symlink(name, target)` extends Node. Resolver recursively follows target with depth limit.

### 12.2 Permissions
Add `mode` (int) and `owner` (str). Wrap operations with permission checks.

### 12.3 Hard links
Reference counting: `File` has `links: int`; `rm` decrements; only remove content when `links == 0`.

### 12.4 Persistence
Serialize tree to JSON on shutdown; load on init.

### 12.5 Watchers
Observer: subscribers get notified on writes/creates/deletes.

### 12.6 Atomic mv + cp
Add a journal: log intent before mutation; complete + commit. Recover from incomplete on restart.

### 12.7 Quota
Track per-directory or per-user size; reject writes that would exceed.

---

## 13. Cheat-Sheet Recap

1. **Problem:** In-memory FS with mkdir/ls/cat/rm/cp/mv and path resolution.
2. **Core entities:** `Node`, `File`, `Directory`, `FileSystem`, `Session`.
3. **Patterns:** Composite (Node hierarchy), Facade (FileSystem), per-session view via Session.
4. **Path resolution:** Custom `_normalize` handles `.`, `..`, absolute vs relative.
5. **Concurrency:** Tree-level RLock. Per-dir locks for scaling.
6. **Trade-offs:** Recursive size (matches `du`); auto-create on `write` (UNIX-like); no permissions in base.

---

## Appendix A: Test cases

```
1. mkdir /a, mkdir /a/b, write /a/b/c.txt → ls /a/b shows c.txt.
2. ../ resolves correctly: /a/b/../file → /a/file.
3. mkdir -p creates intermediates; without -p errors on missing.
4. rm on non-empty dir without -r → NotEmpty.
5. cp -r recursively copies subtree.
6. mv renames within same dir.
7. mv into existing dir → moves under that dir.
8. concurrent mkdir of 50 children → all succeed.
9. cd into nonexistent path → NotFound.
10. write auto-creates a missing file.
```

## Appendix B: Common Python-specific gotchas

```
- Mutating a dict while iterating: collect keys first, then iterate.
- String split('/', '/') gives ['', '', ''] for '//' — filter empties.
- bytes is immutable; bytearray is mutable; choose for write performance.
- Path libs (pathlib) exist but are filesystem-specific; we roll our own.
- threading.RLock allows reentry; necessary because some methods call others.
```

## Appendix C: Why this question is loved by interviewers

```
- Tests tree traversal (a fundamental skill).
- Path resolution is a hidden trick — tests attention to detail.
- Composite pattern is a natural fit — tests OOD vocabulary.
- 60-min implementation is achievable; covers ~10 ops.
- Open-ended extensions (symlinks, permissions, hard links).
```
