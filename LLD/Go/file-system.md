# In-Memory File System — Low-Level Design (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[ood]` `[tree]` `[interfaces]` `[path-resolution]`
> **Language:** Go 1.21+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon, Microsoft, Google, Atlassian, Bloomberg, Dropbox

---

## Beginner's Guide

### What's this in plain English?

A Linux-style in-memory file system. `mkdir`, `ls`, `touch`, `cat`. Paths like `/a/b/c`. Files have content; directories have children. Tree.

### Why solve it?

- **Real world**: file systems, zip contents, JSON paths, S3 prefixes.
- **Teaches**: tree structures, path parsing, Composite pattern (file/dir share an interface).

### Vocabulary

- **Path** — `/a/b/c.txt`.
- **Node** — file or directory.
- **Composite pattern** — uniform interface across leaves and branches.

### High-level approach

Entities:
- **Node** interface — `Name()`, `IsDir()`.
- **File** — content.
- **Directory** — `map[string]Node`.
- **FileSystem** — root + path operations.

Path resolution: split on `/`, walk children. Operations: mkdir, ls, read, write, delete, move.

### How to read this doc

- **Beginner**: Node + path resolution.
- **Interview**: permissions, symlinks, multi-user.

---

## 0. How to use this doc in an interview

Python version covers Composite pattern + path resolution. **In Go, the conversation pivots:**
- **Interface for Node**, with `*File` and `*Directory` as implementers (not inheritance).
- **Type assertions** at access points (`if f, ok := node.(*File); ok`) — Go's pattern instead of `isinstance`.
- **`sync.RWMutex`** for shared FS.
- **No exceptions** — every op returns `(value, error)`.
- **`strings.Split`** + custom normalization for path components.

---

## 1. Problem Statement
(Same as Python.)

---

## 2. Clarifying Questions
Same as Python.

---

## 3. Functional Requirements
Same.

---

## 4. Actors & Use Cases
Same.

---

## 5. Core Entities

| Entity | Go shape |
|---|---|
| `Node` | interface (Name, Path, Size methods) |
| `File` | struct implementing Node |
| `Directory` | struct implementing Node, with `map[string]Node` children |
| `FileSystem` | facade with `sync.RWMutex` |
| `Session` | per-session CWD; delegates to FS |

---

## 6. Class Diagram (ASCII)

```
                  ┌────────────────────┐
                  │ «interface» Node   │
                  │────────────────────│
                  │ Name() string       │
                  │ Size() int          │
                  │ Path() string       │
                  └─────────▲───────────┘
                            │ implements (duck-typed)
                ┌───────────┼────────────┐
                │                        │
        ┌───────────────┐       ┌────────────────────┐
        │     File      │       │     Directory      │
        │───────────────│       │────────────────────│
        │ name, parent  │       │ name, parent       │
        │ content       │       │ children           │◆──┐
        └───────────────┘       └────────────────────┘   │
                                                         │
                                              recursive ◆ ◀
```

---

## 7. Design Patterns

| Pattern | Go form | Why |
|---|---|---|
| Composite | `Node` interface; Directory.children map | Uniform tree traversal |
| Facade | `FileSystem` exports thin API | |
| Type-switch in resolver | `switch n := node.(type) { case *File: ...; case *Directory: ... }` | Idiomatic for sum-type-like dispatch |

---

## 8. Sequence Diagrams
(Same as Python.)

---

## 9. Concurrency Considerations

`FileSystem.mu sync.RWMutex` — write lock for mutations, read lock for queries. Session methods delegate, so they inherit the lock semantics.

---

## 10. Full Working Code

```go
// File: fs.go
// Build: go run fs.go
package main

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

var (
	ErrNotFound      = errors.New("fs: not found")
	ErrAlreadyExists = errors.New("fs: already exists")
	ErrNotADir       = errors.New("fs: not a directory")
	ErrNotAFile      = errors.New("fs: not a file")
	ErrNotEmpty      = errors.New("fs: not empty")
	ErrInvalidPath   = errors.New("fs: invalid path")
)

// ──────────────────────────────────────────────────────────────────────────
// Node interface + implementations
// ──────────────────────────────────────────────────────────────────────────

type Node interface {
	Name() string
	Size() int
	Path() string
	parent() *Directory
	setParent(*Directory)
	setName(string)
}

type baseNode struct {
	name        string
	parentDir   *Directory
	createdAt   time.Time
	modifiedAt  time.Time
}

func (b *baseNode) Name() string         { return b.name }
func (b *baseNode) parent() *Directory   { return b.parentDir }
func (b *baseNode) setParent(d *Directory) { b.parentDir = d }
func (b *baseNode) setName(s string)     { b.name = s }
func (b *baseNode) Path() string {
	if b.parentDir == nil {
		return "/"
	}
	parts := []string{b.name}
	cur := b.parentDir
	for cur != nil && cur.parentDir != nil {
		parts = append([]string{cur.name}, parts...)
		cur = cur.parentDir
	}
	return "/" + strings.Join(parts, "/")
}

type File struct {
	baseNode
	content []byte
}

func (f *File) Size() int      { return len(f.content) }
func (f *File) Read() []byte   { return f.content }
func (f *File) Write(b []byte, append bool) {
	if append {
		f.content = append_(f.content, b)
	} else {
		f.content = b
	}
	f.modifiedAt = time.Now()
}

func append_(a, b []byte) []byte { return append(a, b...) }

type Directory struct {
	baseNode
	children map[string]Node
}

func (d *Directory) Size() int {
	s := 0
	for _, c := range d.children {
		s += c.Size()
	}
	return s
}

func (d *Directory) Add(n Node) error {
	if _, exists := d.children[n.Name()]; exists {
		return fmt.Errorf("%w: %s in %s", ErrAlreadyExists, n.Name(), d.Path())
	}
	d.children[n.Name()] = n
	n.setParent(d)
	d.modifiedAt = time.Now()
	return nil
}

func (d *Directory) Remove(name string) (Node, error) {
	n, ok := d.children[name]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, name)
	}
	delete(d.children, name)
	n.setParent(nil)
	d.modifiedAt = time.Now()
	return n, nil
}

func newDirectory(name string) *Directory {
	now := time.Now()
	return &Directory{
		baseNode: baseNode{name: name, createdAt: now, modifiedAt: now},
		children: make(map[string]Node),
	}
}

func newFile(name string, content []byte) *File {
	now := time.Now()
	return &File{baseNode: baseNode{name: name, createdAt: now, modifiedAt: now}, content: content}
}

// ──────────────────────────────────────────────────────────────────────────
// FileSystem
// ──────────────────────────────────────────────────────────────────────────

type FileSystem struct {
	root *Directory
	mu   sync.RWMutex
}

func NewFileSystem() *FileSystem {
	return &FileSystem{root: newDirectory("")}
}

func (fs *FileSystem) normalize(path string, cwd []string) []string {
	var base []string
	var rest string
	if strings.HasPrefix(path, "/") {
		base = nil
		rest = strings.TrimPrefix(path, "/")
	} else {
		base = append([]string(nil), cwd...)
		rest = path
	}
	for _, p := range strings.Split(rest, "/") {
		switch p {
		case "", ".":
			continue
		case "..":
			if len(base) > 0 {
				base = base[:len(base)-1]
			}
		default:
			base = append(base, p)
		}
	}
	return base
}

func (fs *FileSystem) resolve(path string, cwd []string) (Node, error) {
	parts := fs.normalize(path, cwd)
	var node Node = fs.root
	for _, p := range parts {
		dir, ok := node.(*Directory)
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrNotADir, node.Path())
		}
		child, ok := dir.children[p]
		if !ok {
			return nil, fmt.Errorf("%w: %s in %s", ErrNotFound, p, dir.Path())
		}
		node = child
	}
	return node, nil
}

func (fs *FileSystem) resolveParent(path string, cwd []string) (*Directory, string, error) {
	parts := fs.normalize(path, cwd)
	if len(parts) == 0 {
		return nil, "", fmt.Errorf("%w: cannot operate on root", ErrInvalidPath)
	}
	leaf := parts[len(parts)-1]
	parentPath := "/" + strings.Join(parts[:len(parts)-1], "/")
	if len(parts) == 1 {
		return fs.root, leaf, nil
	}
	node, err := fs.resolve(parentPath, nil)
	if err != nil {
		return nil, "", err
	}
	dir, ok := node.(*Directory)
	if !ok {
		return nil, "", fmt.Errorf("%w: %s", ErrNotADir, node.Path())
	}
	return dir, leaf, nil
}

// ─── operations ────────────────────────────────────────────────────────

func (fs *FileSystem) Mkdir(path string, cwd []string, parents bool) (*Directory, error) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	parts := fs.normalize(path, cwd)
	if len(parts) == 0 {
		return nil, fmt.Errorf("%w: /", ErrAlreadyExists)
	}
	var node Node = fs.root
	for i, p := range parts {
		dir, ok := node.(*Directory)
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrNotADir, node.Path())
		}
		if existing, ok := dir.children[p]; ok {
			if i == len(parts)-1 {
				return nil, fmt.Errorf("%w: %s", ErrAlreadyExists, existing.Path())
			}
			node = existing
			continue
		}
		if !parents && i < len(parts)-1 {
			return nil, fmt.Errorf("%w: missing intermediate %s", ErrNotFound, p)
		}
		d := newDirectory(p)
		if err := dir.Add(d); err != nil {
			return nil, err
		}
		node = d
	}
	return node.(*Directory), nil
}

func (fs *FileSystem) Touch(path string, cwd []string) (*File, error) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	parent, leaf, err := fs.resolveParent(path, cwd)
	if err != nil {
		return nil, err
	}
	if existing, ok := parent.children[leaf]; ok {
		if f, ok := existing.(*File); ok {
			return f, nil
		}
		return nil, fmt.Errorf("%w: %s", ErrAlreadyExists, leaf)
	}
	f := newFile(leaf, nil)
	if err := parent.Add(f); err != nil {
		return nil, err
	}
	return f, nil
}

func (fs *FileSystem) Write(path string, data []byte, append bool, cwd []string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	node, err := fs.resolve(path, cwd)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			// auto-create
			parent, leaf, perr := fs.resolveParent(path, cwd)
			if perr != nil {
				return perr
			}
			f := newFile(leaf, data)
			return parent.Add(f)
		}
		return err
	}
	f, ok := node.(*File)
	if !ok {
		return fmt.Errorf("%w: %s", ErrNotAFile, path)
	}
	f.Write(data, append)
	return nil
}

func (fs *FileSystem) Read(path string, cwd []string) ([]byte, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	node, err := fs.resolve(path, cwd)
	if err != nil {
		return nil, err
	}
	f, ok := node.(*File)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrNotAFile, path)
	}
	return f.Read(), nil
}

type Entry struct {
	Name string
	Type string // "file" or "dir"
	Size int
}

func (fs *FileSystem) Ls(path string, cwd []string) ([]Entry, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	node, err := fs.resolve(path, cwd)
	if err != nil {
		return nil, err
	}
	if f, ok := node.(*File); ok {
		return []Entry{{Name: f.Name(), Type: "file", Size: f.Size()}}, nil
	}
	dir := node.(*Directory)
	out := make([]Entry, 0, len(dir.children))
	for n, c := range dir.children {
		t := "file"
		if _, ok := c.(*Directory); ok {
			t = "dir"
		}
		out = append(out, Entry{Name: n, Type: t, Size: c.Size()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (fs *FileSystem) Rm(path string, recursive bool, cwd []string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	parent, leaf, err := fs.resolveParent(path, cwd)
	if err != nil {
		return err
	}
	node, ok := parent.children[leaf]
	if !ok {
		return fmt.Errorf("%w: %s", ErrNotFound, path)
	}
	if dir, ok := node.(*Directory); ok && len(dir.children) > 0 && !recursive {
		return fmt.Errorf("%w: %s", ErrNotEmpty, path)
	}
	_, err = parent.Remove(leaf)
	return err
}

func (fs *FileSystem) Cp(src, dst string, recursive bool, cwd []string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	srcNode, err := fs.resolve(src, cwd)
	if err != nil {
		return err
	}
	if _, isDir := srcNode.(*Directory); isDir && !recursive {
		return fmt.Errorf("%w: %s is directory", ErrInvalidPath, src)
	}
	dstNode, err := fs.resolve(dst, cwd)
	var parent *Directory
	var leaf string
	if err == nil {
		dir, ok := dstNode.(*Directory)
		if !ok {
			return fmt.Errorf("%w: %s exists and is not a directory", ErrAlreadyExists, dst)
		}
		parent = dir
		leaf = srcNode.Name()
		if _, ok := parent.children[leaf]; ok {
			return fmt.Errorf("%w: %s", ErrAlreadyExists, leaf)
		}
	} else if errors.Is(err, ErrNotFound) {
		parent, leaf, err = fs.resolveParent(dst, cwd)
		if err != nil {
			return err
		}
	} else {
		return err
	}
	clone := fs.deepCopy(srcNode, leaf)
	return parent.Add(clone)
}

func (fs *FileSystem) Mv(src, dst string, cwd []string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	srcParent, srcLeaf, err := fs.resolveParent(src, cwd)
	if err != nil {
		return err
	}
	srcNode, ok := srcParent.children[srcLeaf]
	if !ok {
		return fmt.Errorf("%w: %s", ErrNotFound, src)
	}
	dstNode, err := fs.resolve(dst, cwd)
	var newParent *Directory
	var newLeaf string
	if err == nil {
		dir, ok := dstNode.(*Directory)
		if !ok {
			return fmt.Errorf("%w: %s", ErrAlreadyExists, dst)
		}
		newParent = dir
		newLeaf = srcLeaf
		if _, ok := newParent.children[newLeaf]; ok {
			return fmt.Errorf("%w: %s", ErrAlreadyExists, newLeaf)
		}
	} else if errors.Is(err, ErrNotFound) {
		newParent, newLeaf, err = fs.resolveParent(dst, cwd)
		if err != nil {
			return err
		}
	} else {
		return err
	}
	if _, err := srcParent.Remove(srcLeaf); err != nil {
		return err
	}
	srcNode.setName(newLeaf)
	if err := newParent.Add(srcNode); err != nil {
		// rollback
		srcNode.setName(srcLeaf)
		_ = srcParent.Add(srcNode)
		return err
	}
	return nil
}

func (fs *FileSystem) Exists(path string, cwd []string) bool {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	_, err := fs.resolve(path, cwd)
	return err == nil
}

func (fs *FileSystem) IsDir(path string, cwd []string) bool {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	n, err := fs.resolve(path, cwd)
	if err != nil {
		return false
	}
	_, ok := n.(*Directory)
	return ok
}

func (fs *FileSystem) IsFile(path string, cwd []string) bool {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	n, err := fs.resolve(path, cwd)
	if err != nil {
		return false
	}
	_, ok := n.(*File)
	return ok
}

func (fs *FileSystem) deepCopy(n Node, newName string) Node {
	switch x := n.(type) {
	case *File:
		c := newFile(newName, append([]byte(nil), x.content...))
		return c
	case *Directory:
		c := newDirectory(newName)
		for cn, child := range x.children {
			clone := fs.deepCopy(child, cn)
			_ = c.Add(clone)
		}
		return c
	}
	return nil
}

// ──────────────────────────────────────────────────────────────────────────
// Session
// ──────────────────────────────────────────────────────────────────────────

type Session struct {
	fs  *FileSystem
	cwd []string
}

func NewSession(fs *FileSystem) *Session { return &Session{fs: fs} }

func (s *Session) Cd(path string) error {
	parts := s.fs.normalize(path, s.cwd)
	target := "/" + strings.Join(parts, "/")
	if !s.fs.IsDir(target, nil) {
		return fmt.Errorf("%w: %s", ErrNotFound, target)
	}
	s.cwd = parts
	return nil
}

func (s *Session) Pwd() string { return "/" + strings.Join(s.cwd, "/") }

// ──────────────────────────────────────────────────────────────────────────
// Demo / tests
// ──────────────────────────────────────────────────────────────────────────

func main() {
	basicTest()
	pathResolutionTest()
	mkdirPTest()
	rmTest()
	cpMvTest()
	concurrentMkdirTest()
	sessionTest()
	fmt.Println("\nAll tests passed.")
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func basicTest() {
	fmt.Println("--- basic ---")
	fs := NewFileSystem()
	must(must2(fs.Mkdir("/a", nil, false)))
	must(must2(fs.Mkdir("/a/b", nil, false)))
	must(fs.Write("/a/b/c.txt", []byte("hello"), false, nil))
	got, err := fs.Read("/a/b/c.txt", nil)
	must(err)
	if string(got) != "hello" {
		panic("read")
	}
	must(fs.Write("/a/b/c.txt", []byte(" world"), true, nil))
	got, _ = fs.Read("/a/b/c.txt", nil)
	if string(got) != "hello world" {
		panic("append")
	}
	listing, _ := fs.Ls("/a/b", nil)
	if len(listing) != 1 || listing[0].Name != "c.txt" {
		panic("ls")
	}
	fmt.Println("  OK")
}

// must2 wraps (T, error) → error
func must2[T any](_ T, err error) error { return err }

func pathResolutionTest() {
	fmt.Println("--- path resolution ---")
	fs := NewFileSystem()
	_, err := fs.Mkdir("/a/b/c", nil, true)
	must(err)
	must(fs.Write("/a/file.txt", []byte("x"), false, nil))
	if !fs.Exists("/a/b/c/../../file.txt", nil) {
		panic("../../ resolution")
	}
	fmt.Println("  OK")
}

func mkdirPTest() {
	fmt.Println("--- mkdir -p ---")
	fs := NewFileSystem()
	_, err := fs.Mkdir("/x/y/z", nil, true)
	must(err)
	if !fs.IsDir("/x/y/z", nil) {
		panic("mkdir -p")
	}
	if _, err := fs.Mkdir("/x/y/z", nil, false); !errors.Is(err, ErrAlreadyExists) {
		panic("expected AlreadyExists")
	}
	if _, err := fs.Mkdir("/q/r/s", nil, false); !errors.Is(err, ErrNotFound) {
		panic("expected NotFound")
	}
	fmt.Println("  OK")
}

func rmTest() {
	fmt.Println("--- rm ---")
	fs := NewFileSystem()
	_, _ = fs.Mkdir("/a/b", nil, true)
	must(fs.Write("/a/b/file", []byte("x"), false, nil))
	if err := fs.Rm("/a", false, nil); !errors.Is(err, ErrNotEmpty) {
		panic("expected NotEmpty")
	}
	must(fs.Rm("/a", true, nil))
	if fs.Exists("/a", nil) {
		panic("/a should be gone")
	}
	fmt.Println("  OK")
}

func cpMvTest() {
	fmt.Println("--- cp/mv ---")
	fs := NewFileSystem()
	_, _ = fs.Mkdir("/src/sub", nil, true)
	must(fs.Write("/src/file.txt", []byte("hi"), false, nil))
	must(fs.Write("/src/sub/inner.txt", []byte("deep"), false, nil))
	_, _ = fs.Mkdir("/dst", nil, false)
	must(fs.Cp("/src", "/dst", true, nil))
	got, _ := fs.Read("/dst/src/file.txt", nil)
	if string(got) != "hi" {
		panic("cp")
	}
	got, _ = fs.Read("/dst/src/sub/inner.txt", nil)
	if string(got) != "deep" {
		panic("cp deep")
	}
	must(fs.Mv("/src/file.txt", "/src/renamed.txt", nil))
	if fs.Exists("/src/file.txt", nil) {
		panic("mv source still exists")
	}
	if !fs.Exists("/src/renamed.txt", nil) {
		panic("mv dest missing")
	}
	fmt.Println("  OK")
}

func concurrentMkdirTest() {
	fmt.Println("--- concurrent mkdir burst ---")
	fs := NewFileSystem()
	_, _ = fs.Mkdir("/parent", nil, false)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = fs.Mkdir(fmt.Sprintf("/parent/d%d", i), nil, false)
		}()
	}
	wg.Wait()
	listing, _ := fs.Ls("/parent", nil)
	if len(listing) != 50 {
		panic(fmt.Sprintf("got %d", len(listing)))
	}
	fmt.Println("  OK; created 50 dirs concurrently")
}

func sessionTest() {
	fmt.Println("--- session ---")
	fs := NewFileSystem()
	s := NewSession(fs)
	_, _ = fs.Mkdir("/home/sarya/work", nil, true)
	must(s.Cd("/home/sarya"))
	must(fs.Write("notes.txt", []byte("todo"), false, s.cwd))
	got, _ := fs.Read("notes.txt", s.cwd)
	if string(got) != "todo" {
		panic("session read")
	}
	if s.Pwd() != "/home/sarya" {
		panic("pwd")
	}
	must(s.Cd(".."))
	if s.Pwd() != "/home" {
		panic("cd ..")
	}
	fmt.Println("  OK")
}
```

### How to run

```bash
go run /path/to/fs.go
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why Node as an interface and not embedding for inheritance?

Go interfaces represent behavior. `File` and `Directory` are *kinds of* Node, sharing a method set. Embedding `baseNode` gives them the common fields (name, parent) without inheritance.

This is the canonical Go "is-a + has-a" combo: behavior via interface, code reuse via embedding.

### 11.2 Why `parent()` and `setParent()` (lowercase methods) on Node?

These are package-internal contract methods. Lowercase = unexported. Outside callers can't muck with parent pointers; the FileSystem owns the topology.

For testing across packages, we'd promote to uppercase. Internal-only here.

### 11.3 Why `errors.Is` over type assertions for error inspection?

`errors.Is` walks the wrap chain (`fmt.Errorf("%w", ...)`). Sentinel errors compare cleanly. Type assertions only work when the error carries structured data (rare in our API).

`errors.As` is for extracting structured error fields. Use both as appropriate.

### 11.4 Why `[]string` for cwd and not a string?

A list of components avoids re-splitting on every operation. Path normalization is `[]string` → `[]string`. Easier to manipulate (push/pop for `cd ..`).

### 11.5 Why does `deepCopy` use `append([]byte(nil), x.content...)` to clone bytes?

Slice copy. `append` to a `nil` base produces a fresh underlying array — no shared mutation. `copy(dst, src)` would also work but requires pre-allocating `dst`.

For large files, both are O(N). For small bytes, `append` is the clearest expression.

### 11.6 What if I want symlinks?

Add `type Symlink struct { baseNode; target string }`. The resolver follows symlinks with a depth counter; cycles raise an error.

Type assertion in resolve: `if sym, ok := node.(*Symlink); ok { ... resolve sym.target ... }`.

### 11.7 Why `RWMutex` over `Mutex`?

`Ls`, `Read`, `Exists` are read-only — they parallelize under RLock. Writes serialize. For dashboard-heavy use, this matters; for a basic interview demo, `Mutex` would suffice.

### 11.8 Why does `Mv` rollback on failure?

Atomicity. If `newParent.Add` fails (e.g. AlreadyExists on a duplicate name), we restore the source state — re-add to the original parent. Otherwise the file is orphaned.

We use `srcNode.setName(srcLeaf)` then `srcParent.Add(srcNode)` — rollback. In production, a journal would be cleaner.

### 11.9 What's the failure mode if two goroutines `mv` the same file simultaneously?

Both acquire the write lock; the second waits. First completes (file moved); second finds source missing → `ErrNotFound`. Linearized, no corruption.

The single tree-lock serializes all operations. Per-directory locks would parallelize unrelated mvs but require global lock ordering.

### 11.10 Why the explicit `parent` field instead of computing path lazily?

`Path()` walks parents to build the full path. Without parent pointers, we couldn't compute it. With them, paths are O(depth).

The cost: `Add`/`Remove` must update parent pointers. Trivial overhead.

### 11.11 Why does `Ls` return `[]Entry` and not `[]Node`?

Encapsulation. `Node` exposes mutations via the package-internal contract methods; returning Nodes externally would require us to expose those.

`Entry` is a simple value type that callers can serialize, sort, display.

### 11.12 What's the memory cost of the in-memory FS?

Per file: ~80 bytes (baseNode) + content size.
Per directory: ~80 bytes + map entries.
Plus map overhead (~16 bytes per entry).

For a million small files in 1000 dirs: ~100 MB. Heavy. For real persistence, swap content to a chunk store.

### 11.13 Why does `Write` auto-create the file if missing?

UNIX `>` semantics: redirect creates the target. Convenience layered on `Touch` + `Write`. Strict mode would require explicit `Touch` first.

### 11.14 Why `time.Now()` for timestamps and not a clock interface?

For tests, an injected clock is cleaner (`Now func() time.Time`). We use `time.Now()` directly for brevity. In production, inject.

### 11.15 What about extension to a real FUSE-mounted FS?

The Node abstraction maps cleanly to FUSE callbacks (`Lookup`, `ReadDir`, `Read`, `Write`). The persistence layer (memory → disk) is what changes; the OOD stays.

---

## 12. Extensions
(Same as Python — see Python doc §12.)

---

## 13. Cheat-Sheet Recap

1. **Problem:** In-memory FS with mkdir/ls/cat/rm/cp/mv + path resolution.
2. **Idioms:** Interface for Node, struct embedding for shared fields, sentinel errors.
3. **Patterns:** Composite, Facade, type-switch dispatch.
4. **Concurrency:** `sync.RWMutex` on FileSystem.
5. **Path resolution:** Custom normalize handles `.`, `..`, absolute/relative.
6. **Trade-offs:** Coarse lock; recursive size; auto-create on Write.

---

## Appendix A: How this differs from the Python version

```
Python                          Go
─────────                       ─────
ABC + abstractmethod            interface
isinstance(node, File)          _, ok := node.(*File); if ok ...
super().__init__()              embedding (no super)
raise FSError                   fmt.Errorf("%w", ...)
list[str] for cwd               []string
threading.RLock                 sync.RWMutex
bytes (immutable)               []byte (mutable; copy on cp)
Optional[Directory]             *Directory (nil)
```

## Appendix B: Common Go gotchas

```
- Type assertions on nil interface panic; always check `ok`.
- map iteration order randomized; sort if you need deterministic.
- Slice append may share backing array — copy when isolation matters.
- Embedding + interface: pointer receivers on baseNode methods are subtle.
- defer mu.Unlock() — always; never bare unlock.
- Don't share *FileSystem across processes — only within the process.
```
