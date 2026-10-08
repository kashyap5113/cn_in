# Interactive Sliding Window Protocol Simulator

> Visualizing Go-Back-N and Selective Repeat — Computer Networks Semester Project

---

## Overview

This project is an **interactive, educational simulator** for the Sliding Window Protocol, demonstrating both **Go-Back-N (GBN)** and **Selective Repeat (SR)** protocols. It provides real-time visualization of packet transmission, loss, retransmission, ACK handling, and window management over an unreliable network channel.

The simulator is designed as a **semester project** for the Computer Networks course.

---

## Objectives

1. Visualize the behavior of Sliding Window Protocols in real time.
2. Demonstrate the differences between Go-Back-N and Selective Repeat.
3. Allow configurable network conditions (loss, delay, window size, timeout).
4. Provide protocol performance comparison through headless simulation runs.
5. Serve as an educational tool for understanding reliable data transfer.

---

## Features

| Category | Features |
|---|---|
| **Protocols** | Go-Back-N, Selective Repeat |
| **Simulation** | Real-time animation, step-by-step mode, pause/resume, reset |
| **Configuration** | Packets, window size, packet loss %, delay, timeout, speed |
| **Visualization** | Sender/receiver cell strips, sliding window overlay, animated packets in channel |
| **Interaction** | Click packets to manually drop them, protocol selector |
| **Statistics** | Delivered, transmissions, retransmissions, timeouts, data lost, ACKs lost, efficiency |
| **Event Log** | Timestamped events with badges (SEND, ACK, LOSS, TIMEOUT, RETRANS) |
| **Comparison** | Headless 40-run comparison with table and bar charts |
| **Learning Mode** | Contextual explanations for protocol events |
| **Educational** | Protocol explanations, side-by-side comparison table |
| **UI/UX** | Dark/light theme, responsive design, toast notifications |

---

## Technologies

- **HTML5** — Semantic structure with ARIA labels
- **CSS3** — Custom properties (design tokens), responsive media queries
- **Vanilla JavaScript** — requestAnimationFrame, DOM-free simulation engine
- **Google Fonts** — Inter + JetBrains Mono (with system fallbacks)

No frameworks, build tools, or backend required.

---

## Project Structure

```
sliding-window-simulator/
├── index.html       Main application page
├── style.css        All styling (design system, components, responsive)
├── script.js        Simulation engine + UI rendering + controls
└── README.md        This file
```

---

## How to Run

### Option A: Python Local Server (Recommended)

```bash
cd sliding-window-simulator
python -m http.server 8000
```

Then open: `http://localhost:8000`

### Option B: VS Code Live Server

1. Open the project folder in VS Code.
2. Install the **Live Server** extension (if not already installed).
3. Right-click `index.html` → **Open with Live Server**.
4. The browser opens the project automatically at `http://127.0.0.1:5500`.

### Option C: Any Static File Server

```bash
npx serve .          # Node.js
php -S localhost:8000 # PHP
```

> **Note:** Opening `index.html` directly via `file://` should work since we do not use ES modules, but a local server is recommended for the best experience.

---

## How the Simulation Works

1. The user configures parameters (packets, window size, loss %, delay, timeout).
2. On **Start**, the animation loop calls `sim.tick(dt)` every frame.
3. The `Sim` class sends packets according to the window constraint.
4. Each packet has a random chance of being "lost" (based on loss %).
5. Lost packets trigger timeouts, which cause retransmission.
6. The UI renders sender/receiver cell states, in-flight packets, and statistics.
7. The simulation completes when all packets have been ACKed (`base ≥ N`).

---

## Go-Back-N (GBN)

1. The sender transmits up to **W** packets without waiting for ACK.
2. The receiver only accepts the **next expected** packet (receiver window = 1).
3. Out-of-order packets are **discarded**.
4. ACKs are **cumulative**: ACK n means all packets 0…n have been received.
5. The sender keeps **one timer** for the oldest unacknowledged packet.
6. On timeout, the sender **retransmits the entire window** starting from `base`.

**Trade-off:** Simpler, but wastes bandwidth when only one packet was lost.

---

## Selective Repeat (SR)

1. The sender transmits up to **W** packets without waiting for ACK.
2. The receiver has a **window of size W** and **buffers out-of-order packets**.
3. Each packet is acknowledged **individually**.
4. The sender keeps **one timer per packet**.
5. On timeout, **only the missing packet** is retransmitted.
6. The receiver window advances when consecutive buffered packets can be delivered.

**Trade-off:** More efficient under loss, but requires receiver buffering and per-packet timers.

---

## Testing Checklist

| # | Test Case | Expected Result |
|---|---|---|
| 1 | GBN with 0% loss | All packets delivered, zero retransmissions |
| 2 | GBN with packet loss | Timeout triggers retransmission from base |
| 3 | GBN with ACK loss | Sender retransmits after timeout |
| 4 | SR with 0% loss | All packets delivered, zero retransmissions |
| 5 | SR with packet loss | Only missing packet retransmitted after timeout |
| 6 | SR with out-of-order | Receiver buffers, delivers when gaps filled |
| 7 | Window size = 1 | Stop-and-wait behavior |
| 8 | Large window (8) | Multiple packets in flight simultaneously |
| 9 | Step-by-step mode | Each click advances to the next protocol event |
| 10 | Manual packet drop | Click a moving packet to force its loss |
| 11 | Protocol comparison | Table + bar chart with 40-run averages |
| 12 | Light mode | All elements visible with proper contrast |
| 13 | Dark mode | All elements visible with proper contrast |
| 14 | Mobile layout | Responsive, no overflow or clipping |
| 15 | Local HTTP server | Works at `http://localhost:8000` |

---

## Viva Demonstration Guide

### Demo 1: Go-Back-N

1. Select **Go-Back-N**.
2. Set: Packets = 8, Window = 4, Loss = 20%.
3. Click **Start**.
4. Observe: packet movement, ACKs, losses, timeouts, retransmission from base.
5. Point out: event log, statistics, window sliding.

### Demo 2: Selective Repeat

1. Switch to **Selective Repeat**.
2. Use similar parameters.
3. Observe: out-of-order buffering, individual ACKs, only missing packets retransmitted.

### Demo 3: Comparison

1. Click **Compare Protocols**.
2. Show the performance table and bar charts.

### Demo 4: Step-by-Step

1. Click **Step** to advance one event at a time.
2. Explain each event during the viva.

---

## Viva Q&A

**Q: What is the Sliding Window Protocol?**
A: A flow-control and reliable-delivery mechanism where the sender maintains a window of sequence numbers it's allowed to send. As ACKs arrive, the window slides forward.

**Q: How does Go-Back-N differ from Selective Repeat?**
A: GBN has a receiver window of 1 and uses cumulative ACKs. On loss, it retransmits the entire window. SR has a receiver window of W, buffers out-of-order packets, uses individual ACKs, and retransmits only the lost packet.

**Q: Why is SR more efficient than GBN?**
A: SR only retransmits the specific lost packet, while GBN retransmits the entire window. However, SR requires more complexity (receiver buffer + per-packet timers).

**Q: How does the simulator handle packet loss?**
A: Each packet has a random chance (based on the loss slider) of being dropped. The drop time is pre-calculated when the packet is created.

---

## Academic Information

| Field | Value |
|---|---|
| **Project Title** | Interactive Sliding Window Protocol Simulator |
| **Subject** | Computer Networks |
| **Project Type** | Semester Project |
| **Developed By** | [Your Name] |
| **Enrollment No.** | [Your Enrollment Number] |
| **College** | [Your College] |
| **Department** | Computer Science & Engineering |
| **Academic Year** | 2026–27 |

---

*Built with HTML5, CSS3, and Vanilla JavaScript — no frameworks required.*
