# Trie / Autocomplete — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[tree]` `[autocomplete]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

When you type "ban" and your phone shows "banana, bank, bandana", it's walking a tree where each branch is a letter. That tree is a **trie** (rhymes with "try") — a structure built for prefix queries.

### Why solve it?

- **Real world**: autocomplete, IP routing, spell-check, contact search.
- **Teaches**: tree structures, recursion, walking trees with maps.
- **Interview**: classic autocomplete MC question.

### Vocabulary

- **Trie** — tree where each root-to-node path spells a string.
- **Node** — has children map (next-letter → Node) and an `IsEnd` flag.
- **Prefix** — start of a word; "ban" is a prefix of "banana."

### High-level approach

Each node holds:
- `Children map[rune]*Node` — one child per possible next char.
- `IsEnd bool` — does a full word end here?

**Insert "cat"**: walk root → c → a → t (create missing nodes), mark last `IsEnd`.
**Search "cat"**: walk; success only if final node is `IsEnd`.
**StartsWith "ca"**: walk; success if path exists.
**Autocomplete "ca"**: walk to "ca", DFS all descendants, collect words.

Time: O(word length) — independent of trie size.

### How to read this doc

- **Beginner**: sections 1–2; watch the recursion for autocomplete.
- **Interview**: focus on autocomplete + edge cases.

---

## 1. Approach

Same as Python: tree of nodes; each node = map[rune]*Node + isEnd + freq.

Go-specific: rune (Unicode) keys.

---

## 2. Code

```go
package main

import (
	"fmt"
	"sort"
)

type TrieNode struct {
	children map[rune]*TrieNode
	isEnd    bool
	freq     int
}

func newNode() *TrieNode {
	return &TrieNode{children: make(map[rune]*TrieNode)}
}

type Trie struct {
	root *TrieNode
}

func NewTrie() *Trie { return &Trie{root: newNode()} }

func (t *Trie) Insert(word string, freq int) {
	node := t.root
	for _, ch := range word {
		child, ok := node.children[ch]
		if !ok {
			child = newNode()
			node.children[ch] = child
		}
		node = child
	}
	node.isEnd = true
	node.freq += freq
}

func (t *Trie) Search(word string) bool {
	n := t.traverse(word)
	return n != nil && n.isEnd
}

func (t *Trie) StartsWith(prefix string) bool {
	return t.traverse(prefix) != nil
}

func (t *Trie) Complete(prefix string, k int) []struct {
	Word string
	Freq int
} {
	n := t.traverse(prefix)
	if n == nil {
		return nil
	}
	type res struct {
		Word string
		Freq int
	}
	var out []res
	var collect func(*TrieNode, string)
	collect = func(node *TrieNode, p string) {
		if node.isEnd {
			out = append(out, res{p, node.freq})
		}
		for ch, child := range node.children {
			collect(child, p+string(ch))
		}
	}
	collect(n, prefix)
	sort.Slice(out, func(i, j int) bool { return out[i].Freq > out[j].Freq })
	if len(out) > k {
		out = out[:k]
	}
	// repackage
	final := make([]struct {
		Word string
		Freq int
	}, len(out))
	for i, r := range out {
		final[i] = r
	}
	return final
}

func (t *Trie) traverse(word string) *TrieNode {
	node := t.root
	for _, ch := range word {
		child, ok := node.children[ch]
		if !ok {
			return nil
		}
		node = child
	}
	return node
}

// Tests

func main() {
	basic()
	autocomplete()
	fmt.Println("All tests passed.")
}

func basic() {
	fmt.Println("--- basic ---")
	t := NewTrie()
	t.Insert("apple", 1)
	t.Insert("app", 1)
	if !t.Search("apple") || !t.Search("app") {
		panic("search failed")
	}
	if t.Search("ap") {
		panic("ap should not be word")
	}
	if !t.StartsWith("ap") {
		panic("ap should be prefix")
	}
	fmt.Println("  OK")
}

func autocomplete() {
	fmt.Println("--- autocomplete ---")
	t := NewTrie()
	t.Insert("apple", 10)
	t.Insert("app", 20)
	t.Insert("application", 5)
	res := t.Complete("ap", 3)
	if len(res) != 3 || res[0].Word != "app" || res[0].Freq != 20 {
		panic(fmt.Sprintf("bad result: %v", res))
	}
	fmt.Printf("  %v\n", res)
}
```

---

## 3. Cross-Questions

### 3.1 Why `rune` keys?
Unicode-safe (CJK, emoji). `byte` would only handle ASCII.

### 3.2 Why map vs array?
Map: variable alphabet; ~32 bytes overhead.
Array[26]: only ASCII; faster.

### 3.3 Generics needed?
Trie is char-based; values are not generic per se. Could template freq type but not needed.

### 3.4 Memory cost?
Each node: map header (~48 bytes) + children pointers.
For 1M words avg 10 chars: ~10M nodes × 100 bytes = 1 GB.
Compressed trie cuts this 10x for sparse subtrees.

---

## 4. Cheat-Sheet
1. Tree of `TrieNode` with `map[rune]*TrieNode children`.
2. Insert: walk chars, create as needed.
3. Search: walk; check isEnd.
4. Complete: walk to prefix; DFS subtree; sort by freq.
