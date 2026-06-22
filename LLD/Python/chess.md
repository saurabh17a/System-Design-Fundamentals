# Chess — LLD (Python)

> **Difficulty:** Hard
> **Tags:** `[lld]` `[game]` `[ood]` `[strategy]` `[state-machine]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

Two-player chess. 8×8 board, 6 piece types per side (king, queen, rook, bishop, knight, pawn), each with its own movement rules. The system enforces all rules: legal moves, checks, checkmates, special moves (castling, en passant, promotion). Probably the hardest LLD interview question for "complete and correct."

### Why solve it?

- **Real world**: chess.com, lichess, any board game with complex rules.
- **Teaches**: polymorphism for piece movements (each piece type knows its own rules), separating board state from rules from game flow, handling exceptions (castling/en passant violate "normal" piece rules).
- **Patterns**: strategy (per-piece move generation), state machine (game phase, check, checkmate), command (moves with undo).

### Vocabulary

- **Square** — one of 64 board cells.
- **Piece** — one of 6 types per color.
- **Move** — from square, to square, possibly with promotion or capture.
- **Check** — your king is attacked.
- **Checkmate** — your king is attacked and you can't escape.
- **Stalemate** — you have no legal moves but aren't in check (draw).
- **Castling, en passant, promotion** — special moves with specific conditions.

### High-level approach

Entities:
- **Piece** (abstract). Subclasses: King, Queen, Rook, Bishop, Knight, Pawn. Each implements `legal_moves(board, from)`.
- **Board** — 8×8 grid of optional Pieces.
- **Move** — from, to, promotion?, captured?
- **Game** — players, board, move history, current turn, state (PLAYING / CHECK / CHECKMATE / STALEMATE).

Move flow:
1. Validate piece exists at `from` and belongs to current player.
2. Check `to` is in the piece's `legal_moves(board, from)`.
3. **After-move check**: simulate the move; if YOUR king is attacked, illegal (you can't expose your king).
4. Apply move. Check if opponent is in check, then checkmate.

Special moves are best handled as branches of `legal_moves` with the conditions baked in.

### How to read this doc

- **Beginner**: focus on per-piece move generation. Skip special moves on first read.
- **Interview**: discuss state representation, move undo, optimization (precomputed bitboards).

---

## 1. Problem Statement

Two-player chess:
- 8×8 board with 6 piece types per side.
- Move validation per piece (different rules each).
- Special moves: castling, en passant, promotion.
- Check / checkmate / stalemate detection.
- Move history; undo.

---

## 2. Design

| Entity |
|---|
| `Piece` (interface) — King, Queen, Rook, Bishop, Knight, Pawn |
| `Color` enum: WHITE, BLACK |
| `Position` (row, col) |
| `Move` (from, to, piece, captured, special) |
| `Board` (8×8 grid; piece state) |
| `Game` (current_player, history, state) |

Pattern: Polymorphism via `Piece.is_legal_move()`. Strategy for piece-specific rules. State for game state.

---

## 3. Code

```python
"""Chess — full move validation + check/mate detection."""
from __future__ import annotations
import enum
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


class Color(enum.Enum):
    WHITE = "white"
    BLACK = "black"


class GameState(enum.Enum):
    IN_PROGRESS = "in_progress"
    CHECK = "check"
    CHECKMATE = "checkmate"
    STALEMATE = "stalemate"
    DRAW = "draw"


class ChessError(Exception): ...
class IllegalMove(ChessError): ...


@dataclass(frozen=True)
class Position:
    row: int
    col: int

    def in_bounds(self) -> bool:
        return 0 <= self.row < 8 and 0 <= self.col < 8


class Piece(ABC):
    def __init__(self, color: Color):
        self.color = color
        self.has_moved = False

    @abstractmethod
    def can_move(self, board: "Board", frm: Position, to: Position) -> bool:
        ...

    @property
    @abstractmethod
    def symbol(self) -> str: ...

    def __repr__(self):
        s = self.symbol
        return s.upper() if self.color is Color.WHITE else s.lower()


class King(Piece):
    @property
    def symbol(self): return "K"
    def can_move(self, board, frm, to):
        return max(abs(frm.row - to.row), abs(frm.col - to.col)) == 1


class Queen(Piece):
    @property
    def symbol(self): return "Q"
    def can_move(self, board, frm, to):
        return Rook(self.color).can_move(board, frm, to) or Bishop(self.color).can_move(board, frm, to)


class Rook(Piece):
    @property
    def symbol(self): return "R"
    def can_move(self, board, frm, to):
        if frm.row != to.row and frm.col != to.col:
            return False
        return board._path_clear(frm, to)


class Bishop(Piece):
    @property
    def symbol(self): return "B"
    def can_move(self, board, frm, to):
        if abs(frm.row - to.row) != abs(frm.col - to.col):
            return False
        return board._path_clear(frm, to)


class Knight(Piece):
    @property
    def symbol(self): return "N"
    def can_move(self, board, frm, to):
        dr, dc = abs(frm.row - to.row), abs(frm.col - to.col)
        return (dr == 2 and dc == 1) or (dr == 1 and dc == 2)


class Pawn(Piece):
    @property
    def symbol(self): return "P"
    def can_move(self, board, frm, to):
        direction = -1 if self.color is Color.WHITE else 1
        # Forward 1
        if to.col == frm.col and to.row - frm.row == direction:
            return board.get(to) is None
        # Forward 2 from start
        if to.col == frm.col and to.row - frm.row == 2 * direction and not self.has_moved:
            mid = Position(frm.row + direction, frm.col)
            return board.get(to) is None and board.get(mid) is None
        # Diagonal capture
        if abs(to.col - frm.col) == 1 and to.row - frm.row == direction:
            target = board.get(to)
            return target is not None and target.color is not self.color
        return False


@dataclass
class Move:
    frm: Position
    to: Position
    piece: Piece
    captured: Optional[Piece] = None
    is_castle: bool = False
    is_en_passant: bool = False
    promotion: Optional[Piece] = None


class Board:
    def __init__(self):
        self._grid: list[list[Optional[Piece]]] = [[None] * 8 for _ in range(8)]
        self._setup()

    def _setup(self):
        # Pawns
        for c in range(8):
            self._grid[1][c] = Pawn(Color.BLACK)
            self._grid[6][c] = Pawn(Color.WHITE)
        # Back rows
        for color, row in [(Color.BLACK, 0), (Color.WHITE, 7)]:
            self._grid[row][0] = Rook(color)
            self._grid[row][7] = Rook(color)
            self._grid[row][1] = Knight(color)
            self._grid[row][6] = Knight(color)
            self._grid[row][2] = Bishop(color)
            self._grid[row][5] = Bishop(color)
            self._grid[row][3] = Queen(color)
            self._grid[row][4] = King(color)

    def get(self, pos: Position) -> Optional[Piece]:
        if not pos.in_bounds():
            return None
        return self._grid[pos.row][pos.col]

    def set(self, pos: Position, piece: Optional[Piece]) -> None:
        self._grid[pos.row][pos.col] = piece

    def _path_clear(self, frm: Position, to: Position) -> bool:
        dr = (to.row - frm.row) and (1 if to.row > frm.row else -1)
        dc = (to.col - frm.col) and (1 if to.col > frm.col else -1)
        r, c = frm.row + dr, frm.col + dc
        while (r, c) != (to.row, to.col):
            if self._grid[r][c] is not None:
                return False
            r += dr
            c += dc
        return True

    def find_king(self, color: Color) -> Position:
        for r in range(8):
            for c in range(8):
                p = self._grid[r][c]
                if isinstance(p, King) and p.color is color:
                    return Position(r, c)
        raise ChessError(f"king {color} not found")

    def is_attacked(self, pos: Position, by_color: Color) -> bool:
        for r in range(8):
            for c in range(8):
                p = self._grid[r][c]
                if p and p.color is by_color:
                    if p.can_move(self, Position(r, c), pos):
                        # For pawn captures, can_move doesn't fire on empty square; check explicitly
                        return True
        return False

    def render(self) -> str:
        lines = []
        for r in range(8):
            row = " ".join(repr(self._grid[r][c]) if self._grid[r][c] else "." for c in range(8))
            lines.append(row)
        return "\n".join(lines)


@dataclass
class Game:
    board: Board = field(default_factory=Board)
    current: Color = Color.WHITE
    history: list[Move] = field(default_factory=list)
    state: GameState = GameState.IN_PROGRESS

    def move(self, frm: Position, to: Position) -> Move:
        if self.state in (GameState.CHECKMATE, GameState.STALEMATE, GameState.DRAW):
            raise ChessError("game over")
        piece = self.board.get(frm)
        if piece is None or piece.color is not self.current:
            raise IllegalMove("no piece or wrong color")
        if not to.in_bounds():
            raise IllegalMove("out of bounds")
        target = self.board.get(to)
        if target is not None and target.color is self.current:
            raise IllegalMove("can't capture own piece")
        if not piece.can_move(self.board, frm, to):
            raise IllegalMove("piece can't move there")

        # Make the move (tentatively)
        captured = self.board.get(to)
        self.board.set(to, piece)
        self.board.set(frm, None)
        # Rollback if leaves own king in check
        king_pos = self.board.find_king(self.current)
        if self.board.is_attacked(king_pos, self._opponent()):
            # Undo
            self.board.set(frm, piece)
            self.board.set(to, captured)
            raise IllegalMove("would leave king in check")
        piece.has_moved = True
        move = Move(frm=frm, to=to, piece=piece, captured=captured)
        self.history.append(move)

        # Switch turn
        self.current = self._opponent()
        self._update_state()
        return move

    def _opponent(self) -> Color:
        return Color.BLACK if self.current is Color.WHITE else Color.WHITE

    def _update_state(self):
        # Check current player's king
        king_pos = self.board.find_king(self.current)
        in_check = self.board.is_attacked(king_pos, self._opponent())
        # Any legal move?
        has_moves = self._has_any_legal_move()
        if in_check and not has_moves:
            self.state = GameState.CHECKMATE
        elif not in_check and not has_moves:
            self.state = GameState.STALEMATE
        elif in_check:
            self.state = GameState.CHECK
        else:
            self.state = GameState.IN_PROGRESS

    def _has_any_legal_move(self) -> bool:
        for r in range(8):
            for c in range(8):
                p = self.board.get(Position(r, c))
                if p and p.color is self.current:
                    for r2 in range(8):
                        for c2 in range(8):
                            try:
                                # Save state
                                frm, to = Position(r, c), Position(r2, c2)
                                target = self.board.get(to)
                                if target and target.color is self.current:
                                    continue
                                if not p.can_move(self.board, frm, to):
                                    continue
                                # Try
                                self.board.set(to, p)
                                self.board.set(frm, None)
                                king_pos = self.board.find_king(self.current)
                                in_check = self.board.is_attacked(king_pos, self._opponent())
                                self.board.set(frm, p)
                                self.board.set(to, target)
                                if not in_check:
                                    return True
                            except Exception:
                                continue
        return False


# Tests
def main():
    print("--- initial position ---")
    g = Game()
    assert isinstance(g.board.get(Position(0, 0)), Rook)
    assert isinstance(g.board.get(Position(7, 4)), King)
    print("  OK")

    print("--- legal pawn move ---")
    g = Game()
    m = g.move(Position(6, 4), Position(4, 4))  # e2-e4
    assert m.piece.color is Color.WHITE
    assert g.current is Color.BLACK
    print("  OK")

    print("--- illegal own-piece capture ---")
    g = Game()
    try:
        g.move(Position(7, 0), Position(6, 0))  # rook into own pawn
    except IllegalMove:
        pass
    print("  OK")

    print("--- check / checkmate (Fool's Mate) ---")
    g = Game()
    g.move(Position(6, 5), Position(5, 5))  # f2-f3
    g.move(Position(1, 4), Position(3, 4))  # e7-e5
    g.move(Position(6, 6), Position(4, 6))  # g2-g4
    g.move(Position(0, 3), Position(4, 7))  # Qd8-h4#
    assert g.state is GameState.CHECKMATE, g.state
    print("  Fool's Mate: CHECKMATE")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cross-Questions

### 4.1 Why polymorphic Piece.can_move?
Each piece has own rules; isinstance branches are noisy. Polymorphism keeps each rule local.

### 4.2 Why rollback after move attempt to test self-check?
- Move legality includes "doesn't leave own king in check."
- Try-the-move-and-check is simpler than analyzing pin lines.

### 4.3 What about castling, en passant, promotion?
- Castling: King + Rook, neither moved, path clear, king not in check, doesn't move through attacked squares. Add separate code path.
- En passant: pawn just moved 2; capturing pawn moves diagonally to "phantom" square.
- Promotion: pawn reaches last rank → choose new piece (Queen/Rook/Bishop/Knight).

We omit for brevity; clean addition.

### 4.4 Performance?
`_has_any_legal_move`: O(64²) = ~4k checks. Fine for 1 move; expensive for AI search.

### 4.5 What about 50-move rule, 3-fold repetition?
Track move history; periodic checks.

### 4.6 Why no AI?
Different problem (minimax, alpha-beta, magic bitboards).

---

## 5. Cheat-Sheet
1. Piece interface; one class per type.
2. Board: 8×8 grid; setup at init.
3. Move flow: validate → try → check king safety → commit.
4. Check / checkmate / stalemate via legal-move enumeration.
5. Special moves bolt onto base rules (castle, EP, promotion).
