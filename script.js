// ========================================
// SLIDING WINDOW PROTOCOL SIMULATOR
// Computer Networks — Semester Project
// ========================================
// Single-file JavaScript: simulation engine + UI rendering + controls.
// The Sim class is DOM-free and can run headless for comparison.

'use strict';

// ========================================
// SIMULATION ENGINE (DOM-free)
// ========================================

// Core simulator for both Go-Back-N and Selective Repeat.
// Parameters object (p) must have: proto, N, W, loss, delay, timeout, interval.
class Sim {
  constructor(p, rng = Math.random) {
    this.p = p;
    this.rng = rng;

    // Simulation clock
    this.time = 0;

    // Sender state
    this.base = 0;           // Oldest unacknowledged packet
    this.nextSeq = 0;        // Next sequence number to send
    this.nextSendAt = 0;     // When the sender can send the next packet

    // Go-Back-N: single timer for the oldest unacked packet
    this.timerStart = null;

    // Selective Repeat: per-packet timer and ACK flag
    this.timers = [];
    this.acked = [];

    // Track how many times each packet has been sent (for retransmission detection)
    this.sentCount = [];

    // Receiver state (Go-Back-N)
    this.expected = 0;       // Next in-order packet the receiver expects

    // Receiver state (Selective Repeat)
    this.rcvBase = 0;        // Receiver window base
    this.buf = [];           // Receiver buffer (true if packet has been received)

    // Delivery counter
    this.delivered = 0;

    // In-flight packets (visual + simulation)
    this.packets = [];
    this.pid = 0;

    // Event log (append-only)
    this.log = [];

    // Completion flag
    this.done = false;
    this.doneTime = null;

    // Statistics counters
    this.st = {
      tx: 0,
      retx: 0,
      timeouts: 0,
      lostData: 0,
      lostAck: 0,
      acksRecv: 0
    };
  }

  // Append a timestamped event to the log.
  say(cls, msg) {
    this.log.push({ t: this.time, cls: cls, msg: msg });
  }

  // Create a packet (data or ack) and launch it into the channel.
  // Each packet has a random chance of being "lost" based on loss %.
  launch(kind, seq, retx) {
    retx = retx || false;
    var lost = this.rng() * 100 < this.p.loss;
    var pk = {
      id: this.pid++,
      kind: kind,
      seq: seq,
      retx: retx,
      t0: this.time,
      t1: this.time + this.p.delay,
      dropAt: lost ? this.time + this.p.delay * (0.3 + 0.4 * this.rng()) : null,
      done: false,
      lost: false,
      doneAt: 0,
      stop: 0
    };
    this.packets.push(pk);
    return pk;
  }

  // Manual drop: user clicked a packet in the channel.
  drop(id) {
    var pk = this.packets.find(function(x) { return x.id === id; });
    if (pk && !pk.done && (pk.dropAt === null || pk.dropAt > this.time)) {
      pk.dropAt = this.time;
    }
  }

  // Send a data packet with the given sequence number.
  sendData(seq) {
    var re = (this.sentCount[seq] || 0) > 0;
    this.sentCount[seq] = (this.sentCount[seq] || 0) + 1;
    this.st.tx++;
    if (re) this.st.retx++;
    this.launch('data', seq, re);
    this.say(re ? 'retx' : 'send', (re ? 'Retransmit' : 'Send') + ' packet #' + seq);

    // Start/update timer
    if (this.p.proto === 'gbn') {
      if (this.timerStart === null) this.timerStart = this.time;
    } else {
      this.timers[seq] = this.time;
    }
  }

  // Receiver sends an ACK.
  sendAck(n) {
    this.launch('ack', n);
    this.say('recv', 'Receiver: send ACK ' + n);
  }

  // Handle data packet arrival at receiver.
  onData(seq) {
    if (this.p.proto === 'gbn') {
      // Go-Back-N: only accept the expected packet.
      if (seq === this.expected) {
        this.expected++;
        this.delivered++;
        this.say('recv', 'Receiver: got #' + seq + ' in order, delivered');
        this.sendAck(seq);
      } else {
        this.say('recv', 'Receiver: got #' + seq + ' but expected #' + this.expected + ', discarded');
        if (this.expected > 0) this.sendAck(this.expected - 1);
      }
    } else {
      // Selective Repeat: accept and buffer within receiver window.
      var W = this.p.W;
      if (seq >= this.rcvBase && seq < this.rcvBase + W) {
        if (this.buf[seq]) {
          this.say('recv', 'Receiver: duplicate #' + seq);
        } else {
          this.buf[seq] = true;
          if (seq === this.rcvBase) {
            this.say('recv', 'Receiver: got #' + seq + ' in order');
          } else {
            this.say('recv', 'Receiver: got #' + seq + ' out of order, buffered');
          }
        }
        this.sendAck(seq);
        // Advance receiver window if possible.
        var old = this.rcvBase;
        while (this.buf[this.rcvBase]) {
          this.rcvBase++;
          this.delivered++;
        }
        if (this.rcvBase !== old) {
          this.say('recv', 'Receiver: delivered up to #' + (this.rcvBase - 1) + ', window base = ' + this.rcvBase);
        }
      } else if (seq < this.rcvBase && seq >= this.rcvBase - W) {
        this.say('recv', 'Receiver: old packet #' + seq + ' again, re-sending ACK');
        this.sendAck(seq);
      } else {
        this.say('recv', 'Receiver: #' + seq + ' outside window, ignored');
      }
    }
  }

  // Handle ACK arrival at sender.
  onAck(n) {
    this.st.acksRecv++;
    if (this.p.proto === 'gbn') {
      // Go-Back-N: cumulative ACK.
      if (n >= this.base) {
        this.base = n + 1;
        this.nextSeq = Math.max(this.nextSeq, this.base);
        this.say('ack', 'Sender: cumulative ACK ' + n + ', window slides to base ' + this.base);
        this.timerStart = (this.base === this.nextSeq) ? null : this.time;
      } else {
        this.say('ack', 'Sender: duplicate ACK ' + n + ' ignored');
      }
    } else {
      // Selective Repeat: individual ACK.
      if (!this.acked[n]) {
        this.acked[n] = true;
        this.timers[n] = null;
        var ob = this.base;
        while (this.acked[this.base]) this.base++;
        if (this.base !== ob) {
          this.say('ack', 'Sender: ACK ' + n + ' received, window slides to base ' + this.base);
        } else {
          this.say('ack', 'Sender: ACK ' + n + ' received, window stays (packet #' + this.base + ' still missing)');
        }
      } else {
        this.say('ack', 'Sender: duplicate ACK ' + n + ' ignored');
      }
    }
  }

  // Advance the simulation by dt seconds.
  tick(dt) {
    if (this.done) return;
    this.time += dt;

    // Process in-flight packets (delivery or loss).
    for (var i = 0; i < this.packets.length; i++) {
      var pk = this.packets[i];
      if (pk.done) continue;

      if (pk.dropAt !== null && this.time >= pk.dropAt) {
        // Packet is lost.
        pk.done = true;
        pk.lost = true;
        pk.doneAt = this.time;
        pk.stop = Math.min(1, (pk.dropAt - pk.t0) / (pk.t1 - pk.t0));
        if (pk.kind === 'data') this.st.lostData++;
        else this.st.lostAck++;
        this.say('lost', (pk.kind === 'data' ? 'Packet #' : 'ACK ') + pk.seq + ' lost in the channel');
      } else if (this.time >= pk.t1) {
        // Packet arrived.
        pk.done = true;
        pk.doneAt = this.time;
        if (pk.kind === 'data') this.onData(pk.seq);
        else this.onAck(pk.seq);
      }
    }

    // Remove packets that have finished their visual lifetime.
    var now = this.time;
    this.packets = this.packets.filter(function(pk) {
      return !pk.done || (pk.lost && now - pk.doneAt < 0.8);
    });

    // Check timeouts.
    if (this.p.proto === 'gbn') {
      // Go-Back-N: single timer for the oldest unacked packet.
      if (this.timerStart !== null && this.base < this.nextSeq && this.time - this.timerStart >= this.p.timeout) {
        this.st.timeouts++;
        this.say('timeout', 'Timeout. Go back: resend from packet #' + this.base);
        this.nextSeq = this.base;
        this.timerStart = null;
        this.nextSendAt = this.time;
      }
    } else {
      // Selective Repeat: per-packet timers.
      for (var s = this.base; s < this.nextSeq; s++) {
        if (!this.acked[s] && this.timers[s] != null && this.time - this.timers[s] >= this.p.timeout) {
          this.st.timeouts++;
          this.say('timeout', 'Timeout for packet #' + s + ', resend only this one');
          this.sendData(s);
        }
      }
    }

    // Send next packet if the window allows.
    if (this.time >= this.nextSendAt && this.nextSeq < Math.min(this.base + this.p.W, this.p.N)) {
      this.sendData(this.nextSeq++);
      this.nextSendAt = this.time + this.p.interval;
    }

    // Check for completion.
    if (this.base >= this.p.N && !this.done) {
      this.done = true;
      this.doneTime = this.time;
      this.say('info', 'All ' + this.p.N + ' packets acknowledged. Transfer complete.');
    }
  }
}

// ========================================
// UI — DOM REFERENCES & STATE
// ========================================

var params = {
  proto: 'gbn',
  N: 12,
  W: 4,
  loss: 20,
  delay: 1.5,
  timeout: 5,
  speed: 1,
  interval: 0.3
};

var CELL_STEP = 46; // cell width (42) + gap (4)
var sim;
var running = false;
var logShown = 0;
var pktEls = new Map(); // packet id -> DOM element
var senderCells, senderWin, receiverCells, receiverWin;
var learningMode = false;
var lastLearnMsg = '';
var inStepMode = false;

// Shortcut for querySelector.
function $(sel) { return document.querySelector(sel); }

// ========================================
// INITIALIZATION & RESET
// ========================================

// Build the cell strip for sender or receiver.
function buildTrack(trackEl, count) {
  trackEl.innerHTML = '';
  var cells = [];
  for (var i = 0; i < count; i++) {
    var c = document.createElement('div');
    c.className = 'cell idle';
    c.textContent = i;
    trackEl.appendChild(c);
    cells.push(c);
  }
  // Window bracket overlay.
  var win = document.createElement('div');
  win.className = 'win-bracket';
  trackEl.appendChild(win);
  return { cells: cells, win: win };
}

// Reset the simulation to initial state.
function resetSimulation() {
  running = false;
  inStepMode = false;
  sim = new Sim(params);
  logShown = 0;
  lastLearnMsg = '';
  $('#eventLog').innerHTML = '';
  $('#stepInfoPanel').hidden = true;
  $('#learningPanel').hidden = true;

  // Clear old packet elements.
  pktEls.forEach(function(el) { el.remove(); });
  pktEls.clear();

  // Rebuild cell strips.
  var sData = buildTrack($('#senderTrack'), params.N);
  senderCells = sData.cells;
  senderWin = sData.win;

  var rData = buildTrack($('#receiverTrack'), params.N);
  receiverCells = rData.cells;
  receiverWin = rData.win;

  $('#senderScroll').scrollLeft = 0;
  $('#receiverScroll').scrollLeft = 0;
  $('#runBtn').textContent = '▶ Start';

  render();
}

// ========================================
// RENDERING — CELL STRIPS & WINDOWS
// ========================================

// Set a cell's class efficiently (avoid unnecessary reflows).
function setCellClass(el, cls) {
  var full = 'cell ' + cls;
  if (el.className !== full) el.className = full;
}

// Position the window bracket overlay.
function positionWindow(win, startIdx, count) {
  count = Math.max(1, Math.min(count, params.N - startIdx));
  win.style.left = (startIdx * CELL_STEP + 2) + 'px';
  win.style.width = (count * CELL_STEP + 4) + 'px';
}

// Auto-scroll a strip to keep the relevant index visible.
function autoScroll(stripEl, idx) {
  var want = idx * CELL_STEP - 60;
  if (Math.abs(stripEl.scrollLeft - want) > 120) {
    stripEl.scrollLeft = Math.max(0, want);
  }
}

// Main render function: updates cells, window, packets, stats, log.
function render() {
  var N = params.N;
  var W = params.W;
  var isGbn = params.proto === 'gbn';

  // Update sender cells.
  for (var i = 0; i < N; i++) {
    var sc;
    if (isGbn) {
      sc = i < sim.base ? 'acked' : i < sim.nextSeq ? 'sent' : i < sim.base + W ? 'usable' : 'idle';
    } else {
      sc = sim.acked[i] ? 'acked' : (i >= sim.base && i < sim.nextSeq) ? 'sent' : (i >= sim.base && i < sim.base + W) ? 'usable' : 'idle';
    }
    setCellClass(senderCells[i], sc);

    // Update receiver cells.
    var rb = isGbn ? sim.expected : sim.rcvBase;
    var rc;
    if (i < rb) {
      rc = 'acked';
    } else if (!isGbn && sim.buf[i]) {
      rc = 'buffered';
    } else if (isGbn ? i === sim.expected : i < sim.rcvBase + W) {
      rc = 'usable';
    } else {
      rc = 'idle';
    }
    setCellClass(receiverCells[i], rc);
  }

  // Position window brackets.
  positionWindow(senderWin, Math.min(sim.base, N - 1), W);
  positionWindow(receiverWin, Math.min(isGbn ? sim.expected : sim.rcvBase, N - 1), isGbn ? 1 : W);

  // Auto-scroll strips.
  autoScroll($('#senderScroll'), sim.base);
  autoScroll($('#receiverScroll'), isGbn ? sim.expected : sim.rcvBase);

  // Update info text.
  $('#senderInfo').textContent = 'base = ' + sim.base + ', next = ' + sim.nextSeq + ', window = ' + W;
  if (isGbn) {
    $('#receiverInfo').textContent = 'expecting #' + sim.expected + ', window = 1';
  } else {
    $('#receiverInfo').textContent = 'base = ' + sim.rcvBase + ', window = ' + W;
  }

  renderPackets();
  renderStats();
  renderLog();
}

// ========================================
// RENDERING — ANIMATED PACKETS
// ========================================

function renderPackets() {
  var chan = $('#channel');
  var w = chan.clientWidth;
  var x0 = 90;
  var x1 = w - 90;
  var seen = new Set();

  for (var i = 0; i < sim.packets.length; i++) {
    var pk = sim.packets[i];
    seen.add(pk.id);

    var el = pktEls.get(pk.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'pkt ' + pk.kind + (pk.retx ? ' retx' : '');
      el.textContent = pk.kind === 'data' ? '#' + pk.seq : 'ACK ' + pk.seq;
      el.title = 'Click to drop this packet';
      // Closure for the click handler.
      (function(pid) {
        el.addEventListener('click', function() { sim.drop(pid); });
      })(pk.id);
      chan.appendChild(el);
      pktEls.set(pk.id, el);
    }

    // Calculate position along the channel.
    var prog = pk.done && pk.lost ? pk.stop : (sim.time - pk.t0) / (pk.t1 - pk.t0);
    prog = Math.max(0, Math.min(1, prog));
    var pw = el.offsetWidth;
    var span = Math.max(0, x1 - x0 - pw);
    var x;
    if (pk.kind === 'data') {
      x = x0 + prog * span;
    } else {
      x = x0 + (1 - prog) * span;
    }
    el.style.transform = 'translateX(' + x + 'px)';

    // Mark as lost visually.
    if (pk.lost && !el.classList.contains('lost')) {
      el.classList.add('lost');
      el.textContent = '✕ ' + el.textContent;
    }
  }

  // Remove elements for packets no longer in the simulation.
  pktEls.forEach(function(el, id) {
    if (!seen.has(id)) {
      el.remove();
      pktEls.delete(id);
    }
  });
}

// ========================================
// RENDERING — STATISTICS
// ========================================

function renderStats() {
  var st = sim.st;
  $('#statDelivered').textContent = sim.delivered + ' / ' + params.N;
  $('#statTime').textContent = sim.time.toFixed(1) + 's';
  $('#statTx').textContent = st.tx;
  $('#statRetx').textContent = st.retx;
  $('#statTimeouts').textContent = st.timeouts;
  $('#statDataLost').textContent = st.lostData;
  $('#statAckLost').textContent = st.lostAck;
  $('#statEff').textContent = st.tx ? Math.round(sim.delivered / st.tx * 100) + '%' : '—';
}

// ========================================
// RENDERING — EVENT LOG
// ========================================

// Badge labels for each event class.
var BADGE_MAP = {
  send: 'SEND',
  retx: 'RETRANS',
  ack: 'ACK',
  recv: 'RECEIVE',
  lost: 'LOSS',
  timeout: 'TIMEOUT',
  info: 'INFO'
};

function renderLog() {
  var ul = $('#eventLog');
  if (logShown === sim.log.length) return;

  for (; logShown < sim.log.length; logShown++) {
    var e = sim.log[logShown];
    var li = document.createElement('li');
    li.className = e.cls;

    // Timestamp.
    var timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = e.t.toFixed(1) + 's';
    li.appendChild(timeSpan);

    // Badge.
    var badge = document.createElement('span');
    badge.className = 'log-badge badge-' + e.cls;
    badge.textContent = BADGE_MAP[e.cls] || e.cls.toUpperCase();
    li.appendChild(badge);

    // Message.
    li.appendChild(document.createTextNode(e.msg));
    ul.appendChild(li);

    // Learning mode explanations.
    if (learningMode) {
      showLearningInsight(e);
    }
  }
  ul.scrollTop = ul.scrollHeight;
}

// ========================================
// LEARNING MODE
// ========================================

// Show a short explanation for important events.
function showLearningInsight(event) {
  var msg = '';
  var cls = event.cls;
  var isGbn = params.proto === 'gbn';

  if (cls === 'lost') {
    msg = 'A packet was lost in the channel. The sender will not receive an ACK for this packet, and after the timeout period expires, it will retransmit.';
  } else if (cls === 'timeout') {
    if (isGbn) {
      msg = 'Timeout detected. In Go-Back-N, the sender retransmits ALL packets starting from the base of the window, because the receiver discards out-of-order packets.';
    } else {
      msg = 'Timeout detected. In Selective Repeat, ONLY the specific timed-out packet is retransmitted, because the receiver can buffer out-of-order packets.';
    }
  } else if (cls === 'recv' && event.msg.indexOf('discarded') >= 0) {
    msg = 'The receiver discarded this out-of-order packet because Go-Back-N only accepts the next expected packet (receiver window = 1).';
  } else if (cls === 'recv' && event.msg.indexOf('buffered') >= 0) {
    msg = 'The receiver buffered this out-of-order packet because Selective Repeat accepts any packet within its receiver window.';
  } else if (cls === 'ack' && event.msg.indexOf('cumulative') >= 0) {
    msg = 'Cumulative ACK: this single ACK confirms all packets up to this sequence number have been received.';
  } else if (cls === 'ack' && event.msg.indexOf('window slides') >= 0 && !isGbn) {
    msg = 'The sender window advanced because the lowest unACKed packet was just acknowledged.';
  }

  if (msg && msg !== lastLearnMsg) {
    lastLearnMsg = msg;
    $('#learningText').textContent = msg;
    $('#learningPanel').hidden = false;
  }
}

// ========================================
// ANIMATION LOOP
// ========================================

var lastFrameTime = performance.now();

function animationFrame(now) {
  var realDt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (running && !sim.done) {
    var dt = realDt * params.speed;
    // Sub-step the simulation for stability.
    while (dt > 0) {
      var step = Math.min(0.02, dt);
      sim.tick(step);
      dt -= step;
    }
  }

  if (sim.done && running) {
    running = false;
    $('#runBtn').textContent = '▶ Run Again';
    showToast('Transfer complete! All ' + params.N + ' packets delivered.', 'success');
  }

  render();
  requestAnimationFrame(animationFrame);
}

// ========================================
// CONTROLS — SLIDERS
// ========================================

function bindSlider(inputId, outputId, paramKey, formatter, needsReset) {
  var input = $('#' + inputId);
  var output = $('#' + outputId);

  function apply() {
    params[paramKey] = parseFloat(input.value);
    output.textContent = formatter(params[paramKey]);
  }

  input.addEventListener('input', function() {
    apply();
    if (needsReset && !running) resetSimulation();
  });
  apply();
}

bindSlider('sliderN', 'outN', 'N', function(v) { return v; }, true);
bindSlider('sliderW', 'outW', 'W', function(v) { return v; }, true);
bindSlider('sliderLoss', 'outLoss', 'loss', function(v) { return v + '%'; }, false);
bindSlider('sliderDelay', 'outDelay', 'delay', function(v) { return v.toFixed(1) + 's'; }, false);
bindSlider('sliderTimeout', 'outTimeout', 'timeout', function(v) { return v.toFixed(1) + 's'; }, false);
bindSlider('sliderSpeed', 'outSpeed', 'speed', function(v) { return v + '×'; }, false);

// ========================================
// CONTROLS — PROTOCOL SELECTOR
// ========================================

var protoBtns = document.querySelectorAll('#protoSeg .proto-btn');
protoBtns.forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (running) {
      showToast('Pause or reset the simulation before switching protocols.', 'warning');
      return;
    }
    protoBtns.forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    params.proto = btn.getAttribute('data-p');
    resetSimulation();
  });
});

// ========================================
// CONTROLS — BUTTONS
// ========================================

// Start / Pause / Resume.
$('#runBtn').addEventListener('click', function() {
  // Validate parameters.
  if (params.W > params.N) {
    showToast('Window size cannot exceed the number of packets.', 'error');
    return;
  }
  if (sim.done) resetSimulation();
  running = !running;
  inStepMode = false;
  if (running) {
    $('#runBtn').textContent = '⏸ Pause';
    lastFrameTime = performance.now(); // avoid time jump
  } else {
    $('#runBtn').textContent = '▶ Resume';
  }
});

// Reset.
$('#resetBtn').addEventListener('click', function() {
  resetSimulation();
  showToast('Simulation reset.', '');
});

// Step to next event.
$('#stepBtn').addEventListener('click', function() {
  if (params.W > params.N) {
    showToast('Window size cannot exceed the number of packets.', 'error');
    return;
  }
  if (sim.done) resetSimulation();
  running = false;
  inStepMode = true;
  $('#runBtn').textContent = '▶ Resume';

  // Advance until a new log event occurs.
  var prevCount = sim.log.length;
  var guard = 0;
  while (sim.log.length === prevCount && !sim.done && guard++ < 1000) {
    sim.tick(0.02);
  }

  // Show step info.
  if (sim.log.length > prevCount) {
    var latest = sim.log[sim.log.length - 1];
    $('#stepEventText').textContent = latest.msg;
    $('#stepInfoPanel').hidden = false;
  } else if (sim.done) {
    $('#stepEventText').textContent = 'Simulation complete.';
    $('#stepInfoPanel').hidden = false;
  }
});

// Clear log.
$('#clearLogBtn').addEventListener('click', function() {
  $('#eventLog').innerHTML = '';
  logShown = sim.log.length; // skip replaying old entries
});

// Learning mode toggle.
$('#learningMode').addEventListener('change', function() {
  learningMode = this.checked;
  if (!learningMode) {
    $('#learningPanel').hidden = true;
    lastLearnMsg = '';
  }
});

// ========================================
// COMPARISON — HEADLESS RUNS
// ========================================

// Run the simulation headless (no DOM) and return averaged statistics.
function runHeadless(proto, runs) {
  var p = {};
  for (var k in params) p[k] = params[k];
  p.proto = proto;

  var totals = { tx: 0, retx: 0, to: 0, time: 0 };

  for (var r = 0; r < runs; r++) {
    var s = new Sim(p);
    var guard = 0;
    while (!s.done && guard++ < 200000) {
      s.tick(0.05);
    }
    totals.tx += s.st.tx;
    totals.retx += s.st.retx;
    totals.to += s.st.timeouts;
    totals.time += s.time;
  }

  for (var key in totals) totals[key] /= runs;
  totals.eff = params.N / totals.tx * 100;
  return totals;
}

$('#cmpBtn').addEventListener('click', function() {
  var runs = 40;
  showToast('Running ' + runs + ' simulations per protocol…', '');

  // Use setTimeout to allow the toast to render.
  setTimeout(function() {
    var g = runHeadless('gbn', runs);
    var s = runHeadless('sr', runs);

    // Build comparison table.
    function row(label, key, fmt, lowerBetter) {
      var gVal = g[key], sVal = s[key];
      var gWins = lowerBetter ? gVal <= sVal : gVal >= sVal;
      var sWins = lowerBetter ? sVal <= gVal : sVal >= gVal;
      var tie = Math.abs(gVal - sVal) < 1e-9;
      return '<tr>' +
        '<td>' + label + '</td>' +
        '<td class="' + (gWins && !tie ? 'winner' : '') + '">' + fmt(gVal) + '</td>' +
        '<td class="' + (sWins && !tie ? 'winner' : '') + '">' + fmt(sVal) + '</td>' +
        '</tr>';
    }

    var tableHtml =
      '<table class="cmp-table">' +
      '<tr><th>Metric (avg of ' + runs + ' runs)</th><th>Go-Back-N</th><th>Selective Repeat</th></tr>' +
      row('Transmissions', 'tx', function(v) { return v.toFixed(1); }, true) +
      row('Retransmissions', 'retx', function(v) { return v.toFixed(1); }, true) +
      row('Timeouts', 'to', function(v) { return v.toFixed(1); }, true) +
      row('Completion Time', 'time', function(v) { return v.toFixed(1) + 's'; }, true) +
      row('Efficiency', 'eff', function(v) { return v.toFixed(0) + '%'; }, false) +
      '</table>';

    // Build simple bar chart.
    var maxTx = Math.max(g.tx, s.tx, 1);
    var barHtml =
      '<div style="margin-top:18px">' +
      '<p style="font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Transmissions Comparison</p>' +
      '<div class="cmp-bar-row"><span class="cmp-bar-label">Go-Back-N</span><div class="cmp-bar-track"><div class="cmp-bar-fill cmp-bar-gbn" style="width:' + (g.tx / maxTx * 100).toFixed(0) + '%">' + g.tx.toFixed(1) + '</div></div></div>' +
      '<div class="cmp-bar-row"><span class="cmp-bar-label">Selective Repeat</span><div class="cmp-bar-track"><div class="cmp-bar-fill cmp-bar-sr" style="width:' + (s.tx / maxTx * 100).toFixed(0) + '%">' + s.tx.toFixed(1) + '</div></div></div>' +
      '</div>';

    var maxEff = Math.max(g.eff, s.eff, 1);
    barHtml +=
      '<div style="margin-top:14px">' +
      '<p style="font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Efficiency Comparison</p>' +
      '<div class="cmp-bar-row"><span class="cmp-bar-label">Go-Back-N</span><div class="cmp-bar-track"><div class="cmp-bar-fill cmp-bar-gbn" style="width:' + (g.eff / maxEff * 100).toFixed(0) + '%">' + g.eff.toFixed(0) + '%</div></div></div>' +
      '<div class="cmp-bar-row"><span class="cmp-bar-label">Selective Repeat</span><div class="cmp-bar-track"><div class="cmp-bar-fill cmp-bar-sr" style="width:' + (s.eff / maxEff * 100).toFixed(0) + '%">' + s.eff.toFixed(0) + '%</div></div></div>' +
      '</div>';

    var noteHtml = '<p class="cmp-note">Settings: ' + params.N + ' packets, window ' + params.W + ', ' +
      params.loss + '% loss, ' + params.delay.toFixed(1) + 's delay, ' + params.timeout.toFixed(1) +
      's timeout. Green highlights the better value.</p>';

    $('#cmpBody').innerHTML = tableHtml + barHtml + noteHtml;
    $('#cmpPanel').hidden = false;
    $('#cmpPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast('Comparison complete!', 'success');
  }, 50);
});

// ========================================
// THEME — LIGHT / DARK
// ========================================

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#themeIcon').textContent = theme === 'dark' ? '🌙' : '☀';
  try { localStorage.setItem('swp-theme', theme); } catch(e) {}
}

// Load saved theme or default to light.
(function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem('swp-theme'); } catch(e) {}
  applyTheme(saved || 'light');
})();

$('#themeToggle').addEventListener('click', function() {
  var current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ========================================
// NAVIGATION — MOBILE MENU & SMOOTH SCROLL
// ========================================

$('#mobileMenuBtn').addEventListener('click', function() {
  $('#mainNav').classList.toggle('open');
});

// Close mobile menu when a link is clicked.
document.querySelectorAll('.nav-link').forEach(function(link) {
  link.addEventListener('click', function() {
    $('#mainNav').classList.remove('open');
    // Update active state.
    document.querySelectorAll('.nav-link').forEach(function(l) { l.classList.remove('active'); });
    this.classList.add('active');
  });
});

// Update active nav link on scroll.
var navSections = ['simulator', 'protocols', 'comparison-section', 'about'];
window.addEventListener('scroll', function() {
  var scrollY = window.scrollY + 100;
  for (var i = navSections.length - 1; i >= 0; i--) {
    var sec = document.getElementById(navSections[i]);
    if (sec && sec.offsetTop <= scrollY) {
      document.querySelectorAll('.nav-link').forEach(function(l) { l.classList.remove('active'); });
      var target = document.querySelector('.nav-link[href="#' + navSections[i] + '"]');
      if (target) target.classList.add('active');
      break;
    }
  }
}, { passive: true });

// ========================================
// TOAST NOTIFICATIONS
// ========================================

function showToast(message, type) {
  var container = $('#toastContainer');
  var toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3000);
}

// ========================================
// STARTUP
// ========================================

resetSimulation();
requestAnimationFrame(animationFrame);
