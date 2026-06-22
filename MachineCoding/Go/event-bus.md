# Event Bus / Pub-Sub — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[channels]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

A bulletin board for code. One part **publishes** events ("user signed up"); others **subscribe** and react. The board in the middle decouples them — publishers don't know who's listening.

### Why solve it?

- **Real world**: in-process event buses; Kafka/Redis pub-sub; domain-event-driven services.
- **Teaches**: observer pattern, channels, backpressure handling.
- **Interview**: tests how you handle slow consumers (drop, block, buffer).

### Vocabulary

- **Topic** — named event category.
- **Publish / Subscribe** — emit / receive.
- **Backpressure** — slow consumer needing handling.
- **Buffered channel** — channel with capacity > 0; doesn't block sender until full.

### High-level approach

`Bus` keeps `map[topic][]chan Event` — one channel per subscriber.

**Subscribe(topic) chan Event**: create a buffered channel, append to the list.
**Publish(topic, ev)**: send to every subscriber's channel.
- If buffered & full → choose: block, drop, or replace oldest.

In Go this is clean: each subscriber holds its own goroutine + buffered channel, so publish is a quick `select` per subscriber.

### How to read this doc

- **Beginner**: focus on the channel-per-subscriber model.
- **Interview**: be ready to discuss drop vs block strategies.

---

## 1. Approach

Per-subscriber buffered channel + goroutine; publishers fan-out to channels.

Drop-on-full is `select default`.

---

## 2. Code

```go
package main

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type Subscription[T any] struct {
	topic    string
	ch       chan T
	cb       func(T)
	dropped  atomic.Int64
	stop     chan struct{}
	doneOnce sync.Once
}

type EventBus[T any] struct {
	mu     sync.RWMutex
	subs   map[string][]*Subscription[T]
	closed atomic.Bool
}

var ErrBusClosed = errors.New("bus closed")

func NewEventBus[T any]() *EventBus[T] {
	return &EventBus[T]{subs: make(map[string][]*Subscription[T])}
}

func (b *EventBus[T]) Subscribe(topic string, cb func(T), bufSize int) (*Subscription[T], error) {
	if b.closed.Load() {
		return nil, ErrBusClosed
	}
	if bufSize <= 0 {
		bufSize = 100
	}
	sub := &Subscription[T]{
		topic: topic,
		ch:    make(chan T, bufSize),
		cb:    cb,
		stop:  make(chan struct{}),
	}
	go func() {
		for {
			select {
			case ev := <-sub.ch:
				func() {
					defer func() { _ = recover() }()
					sub.cb(ev)
				}()
			case <-sub.stop:
				return
			}
		}
	}()
	b.mu.Lock()
	b.subs[topic] = append(b.subs[topic], sub)
	b.mu.Unlock()
	return sub, nil
}

func (b *EventBus[T]) Unsubscribe(sub *Subscription[T]) {
	sub.doneOnce.Do(func() { close(sub.stop) })
	b.mu.Lock()
	subs := b.subs[sub.topic]
	for i, s := range subs {
		if s == sub {
			b.subs[sub.topic] = append(subs[:i], subs[i+1:]...)
			break
		}
	}
	b.mu.Unlock()
}

func (b *EventBus[T]) Publish(topic string, ev T) {
	b.mu.RLock()
	subs := append([]*Subscription[T](nil), b.subs[topic]...)
	b.mu.RUnlock()
	for _, sub := range subs {
		select {
		case sub.ch <- ev:
		default:
			sub.dropped.Add(1)
		}
	}
}

func (b *EventBus[T]) Close() {
	if !b.closed.CompareAndSwap(false, true) {
		return
	}
	b.mu.Lock()
	for _, subs := range b.subs {
		for _, sub := range subs {
			sub.doneOnce.Do(func() { close(sub.stop) })
		}
	}
	b.subs = nil
	b.mu.Unlock()
}

// Tests

func main() {
	basic()
	multipleSubs()
	topicIsolation()
	slowConsumerDrops()
	unsubscribe()
	badSubDoesntKill()
	fmt.Println("All tests passed.")
}

func basic() {
	fmt.Println("--- basic ---")
	bus := NewEventBus[int]()
	defer bus.Close()
	var got []int
	var mu sync.Mutex
	_, _ = bus.Subscribe("ticks", func(v int) {
		mu.Lock(); defer mu.Unlock()
		got = append(got, v)
	}, 100)
	for i := 0; i < 5; i++ {
		bus.Publish("ticks", i)
	}
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	if len(got) != 5 {
		panic(got)
	}
	mu.Unlock()
	fmt.Println("  OK")
}

func multipleSubs() {
	fmt.Println("--- multiple subs ---")
	bus := NewEventBus[string]()
	defer bus.Close()
	var a, b []string
	var mu sync.Mutex
	_, _ = bus.Subscribe("t", func(v string) { mu.Lock(); a = append(a, v); mu.Unlock() }, 10)
	_, _ = bus.Subscribe("t", func(v string) { mu.Lock(); b = append(b, v); mu.Unlock() }, 10)
	bus.Publish("t", "hi")
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	if len(a) != 1 || len(b) != 1 {
		panic("bad fan-out")
	}
	mu.Unlock()
	fmt.Println("  OK")
}

func topicIsolation() {
	fmt.Println("--- topic isolation ---")
	bus := NewEventBus[string]()
	defer bus.Close()
	var foo, bar []string
	var mu sync.Mutex
	bus.Subscribe("foo", func(v string) { mu.Lock(); foo = append(foo, v); mu.Unlock() }, 10)
	bus.Subscribe("bar", func(v string) { mu.Lock(); bar = append(bar, v); mu.Unlock() }, 10)
	bus.Publish("foo", "x")
	bus.Publish("bar", "y")
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	if len(foo) != 1 || len(bar) != 1 {
		panic("topics leaked")
	}
	mu.Unlock()
	fmt.Println("  OK")
}

func slowConsumerDrops() {
	fmt.Println("--- slow consumer drops ---")
	bus := NewEventBus[int]()
	defer bus.Close()
	sub, _ := bus.Subscribe("t", func(int) { time.Sleep(50 * time.Millisecond) }, 5)
	for i := 0; i < 100; i++ {
		bus.Publish("t", i)
	}
	if sub.dropped.Load() == 0 {
		panic("expected drops")
	}
	fmt.Printf("  dropped=%d\n", sub.dropped.Load())
}

func unsubscribe() {
	fmt.Println("--- unsubscribe ---")
	bus := NewEventBus[int]()
	defer bus.Close()
	var got []int
	var mu sync.Mutex
	sub, _ := bus.Subscribe("t", func(v int) { mu.Lock(); got = append(got, v); mu.Unlock() }, 10)
	bus.Publish("t", 1)
	time.Sleep(50 * time.Millisecond)
	bus.Unsubscribe(sub)
	bus.Publish("t", 2)
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	if len(got) != 1 || got[0] != 1 {
		panic(got)
	}
	mu.Unlock()
	fmt.Println("  OK")
}

func badSubDoesntKill() {
	fmt.Println("--- bad sub doesn't kill ---")
	bus := NewEventBus[int]()
	defer bus.Close()
	bus.Subscribe("t", func(v int) { panic("boom") }, 10)
	var got []int
	var mu sync.Mutex
	bus.Subscribe("t", func(v int) { mu.Lock(); got = append(got, v); mu.Unlock() }, 10)
	bus.Publish("t", 42)
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	if len(got) != 1 || got[0] != 42 {
		panic("good sub missed")
	}
	mu.Unlock()
	fmt.Println("  OK")
}
```

---

## 3. Cheat-Sheet
1. Per-subscriber buffered channel + goroutine.
2. Publish: fan-out via `select default` (drop on full).
3. recover() per-callback so panic doesn't kill.
4. Unsubscribe closes stop channel; goroutine exits.
