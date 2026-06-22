# Trie / Autocomplete — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[tree]` `[prefix]` `[autocomplete]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

When you type "ban" into a search box and Google shows "banana, bank, bandana", it's not scanning every word. It's walking a tree where each branch is a letter. That tree is a **trie** (rhymes with "try"). Tries make prefix queries (`startswith`) extremely fast.

### Why solve it?

- **Real world**: autocomplete, IP routing tables, spell checkers, contact search in your phone.
- **Teaches**: tree-based data structures, recursion vs iteration, how to design APIs around prefixes.
- **Interview classic**: shows up in autocomplete-flavored MC rounds.

### Vocabulary

- **Trie** — a tree where each path from root to a node spells a string. "Prefix tree."
- **Node** — one position in the trie; holds children (one per next character) and a flag "is this a word ending?"
- **Prefix** — start of a word (e.g., "ban" is a prefix of "banana").
- **Insert / Search / StartsWith** — standard operations: add a word, check if a word exists, check if any word starts with a prefix.

### High-level approach

A trie is built from `Node` objects. Each `Node` has:
- A `dict` of `char → Node` (its children).
- A boolean `is_end` (true if a word ends at this node).

To **insert "cat"**: walk the tree from root, creating nodes for `c → a → t`, mark the last as `is_end = True`.
To **search "cat"**: walk the same path; return true only if the last node is `is_end`.
To **startswith "ca"**: walk; return true if the path exists at all.
To **autocomplete "ca"**: walk to the "ca" node, then DFS its subtree collecting all is_end nodes.

Time complexity is O(length of word), independent of how many words are in the trie.

### How to read this doc

- **Beginner**: read sections 1–2; pay attention to the recursive structure of insert/search.
- **Interview**: section on autocomplete is the differentiator.

---

## 0. Why this question

Trie tests **prefix-based search efficiency**. Used in autocomplete, IP routing, spell-check.

---

## 1. Problem Statement

Implement Trie:
- `insert(word)`
- `search(word) -> bool` (exact match)
- `starts_with(prefix) -> bool`
- `complete(prefix, k) -> [top k matches]` (autocomplete)

Each node tracks if a word ends there (end-of-word marker).

---

## 2. Approach

```
        root
        / | \
       a  b  c
       |  |
       p  e
       |  |
       p  s
       |  |
       l  t (end)
       |
       e (end)
```

Each node = dict of children + end_of_word flag + (optional) frequency.

For top-K autocomplete: store frequency at end-of-word; aggregate at lookup; return sorted top K.

---

## 3. Code

```python
"""Trie + autocomplete with top-K suggestions."""
from __future__ import annotations
from collections import defaultdict
import heapq


class TrieNode:
    """One node in the trie tree.

    Holds: children (per next-char map), is_end (does a word end here?), and
    freq (how popular this word is, used for autocomplete ranking). __slots__
    keeps node memory tight — important when a trie has millions of nodes.
    """
    __slots__ = ("children", "is_end", "freq")
    def __init__(self):
        self.children: dict[str, TrieNode] = {}
        self.is_end: bool = False
        self.freq: int = 0


class Trie:
    def __init__(self) -> None:
        """Create an empty trie with a root node."""
        self.root = TrieNode()

    def insert(self, word: str, freq: int = 1) -> None:
        """Add a word to the trie, walking/creating nodes char-by-char.

        Why this approach: each character is one tree edge; missing edges are
        created on the fly. The end-of-word flag distinguishes "cat" (a word)
        from "ca" (just a prefix).

        Interview tip: explain that O(L) here is independent of how many words
        are already in the trie — that's the whole reason to use one.
        """
        node = self.root
        for ch in word:
            if ch not in node.children:
                node.children[ch] = TrieNode()
            node = node.children[ch]
        node.is_end = True
        node.freq += freq

    def search(self, word: str) -> bool:
        """Return True only if the exact word is in the trie.

        Interview tip: contrast with starts_with — both walk the same path,
        but search needs is_end == True at the final node, not just "the path
        exists." Easy place to make a one-character mistake.
        """
        node = self._traverse(word)
        return node is not None and node.is_end

    def starts_with(self, prefix: str) -> bool:
        """Return True if any word in the trie starts with this prefix."""
        return self._traverse(prefix) is not None

    def complete(self, prefix: str, k: int = 10) -> list[tuple[str, int]]:
        """Return top-K most frequent completions of `prefix`.

        Why this approach: walk to the prefix node, DFS its subtree to gather
        every (word, freq) ending below it, then sort by freq desc and take K.

        Interview tip: this naive version is O(S log S) where S is subtree size.
        For sub-millisecond serving, precompute top-K per node — trade memory
        for query speed.
        """
        node = self._traverse(prefix)
        if node is None:
            return []
        results: list[tuple[str, int]] = []
        self._collect(node, prefix, results)
        # Top-K by freq desc
        results.sort(key=lambda x: -x[1])
        return results[:k]

    def _traverse(self, word: str) -> TrieNode | None:
        """Walk the trie following `word`'s characters; return final node or None."""
        node = self.root
        for ch in word:
            if ch not in node.children:
                return None
            node = node.children[ch]
        return node

    def _collect(self, node: TrieNode, prefix: str, out: list[tuple[str, int]]) -> None:
        """DFS from `node`, appending every (word, freq) pair found.

        Why recursion: tree shape is naturally recursive; iterative version
        would need an explicit stack and harder bookkeeping. Watch for deep
        recursion on long words — Python default recursion limit is 1000.
        """
        if node.is_end:
            out.append((prefix, node.freq))
        for ch, child in node.children.items():
            self._collect(child, prefix + ch, out)


# ─── Tests ───

def _basic():
    """Insert + search + starts_with smoke test."""
    print("--- basic ---")
    t = Trie()
    t.insert("apple")
    t.insert("app")
    t.insert("application")
    assert t.search("apple")
    assert t.search("app")
    assert not t.search("ap")
    assert t.starts_with("ap")
    assert not t.starts_with("xyz")
    print("  OK")


def _autocomplete():
    """Validate top-K ranking is by descending frequency."""
    print("--- autocomplete ---")
    t = Trie()
    t.insert("apple", freq=10)
    t.insert("app", freq=20)
    t.insert("application", freq=5)
    t.insert("apricot", freq=3)
    t.insert("banana", freq=15)
    
    suggestions = t.complete("ap", k=3)
    # Expected: app(20), apple(10), application(5) or apricot(3)
    assert len(suggestions) == 3
    assert suggestions[0] == ("app", 20)
    assert suggestions[1] == ("apple", 10)
    print(f"  {suggestions}")


def _no_match():
    """Prefix not in trie → empty completions list (not an error)."""
    print("--- no match ---")
    t = Trie()
    t.insert("hello")
    assert t.complete("xyz") == []
    print("  OK")


if __name__ == "__main__":
    _basic()
    _autocomplete()
    _no_match()
    print("\nAll tests passed.")
```

---

## 4. Cross-Questions

### 4.1 Why dict for children vs array of 26?
- Dict: handles arbitrary alphabets (Unicode); ~32 bytes overhead per node.
- Array[26]: faster but only ASCII lowercase; wastes memory when sparse.

### 4.2 Time complexity?
- Insert / search / starts_with: O(L) where L = word length.
- Complete: O(L + S) where S = total chars in subtree.

### 4.3 Space?
- Worst case: O(N × L) for N words of avg length L.
- Compressed trie / radix trie: collapses single-child chains.

### 4.4 Why frequency at end-of-word?
- For autocomplete: rank suggestions.
- Update frequency on use (popularity over time).

### 4.5 Top-K efficiency?
- Naive: collect all, sort, top-K. O(S log S).
- Better: maintain top-K per node (precomputed). O(K) at query.
- Trade: memory for query speed.

### 4.6 What about misspellings?
- Levenshtein automaton + DFS through trie.
- Or BK-tree.

### 4.7 What about deletion?
- Remove end-of-word flag.
- Optionally prune dead subtrees.

---

## 5. Variants
- **Compressed Trie / Patricia**: collapse single-child chains.
- **Radix Trie**: similar; used in IP routing.
- **Suffix Trie / Suffix Array**: for substring search.

---

## 6. Cheat-Sheet
1. `TrieNode` = `{children: dict, is_end, freq}`.
2. Insert/search: O(L) walk.
3. Complete: walk to prefix; DFS subtree; sort by freq.
4. Top-K can be precomputed for sub-millisecond serve.
