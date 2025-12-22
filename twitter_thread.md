# X Thread - Neural Network Fully On-Chain on Solana

---

**1/**
So I tested Solana Python. Wanted to see if it was real or just another hype experiment that'll disappear in 3 months.

My goal? Run a neural network FULLY on-chain. Not just store weights. Actually compute predictions on Solana.

Here's what happened 🧵

---

**2/**
First problem: the program wasn't even deployed on DevNet.

Had to deploy it myself. ~650KB program. Classic Solana stuff.

If you're experimenting, this is step zero. You need a playground.

---

**3/**
Then reality hit.

Solana Python is VERY experimental. Like "half the Python builtins don't exist" experimental.

- `list()` → doesn't work
- `bytes()` → nope
- `def` with closures → good luck

You have to get creative. Read raw bytes and index directly.

---

**4/**
Transaction size limit was a beast.

Max ~1232 bytes per instruction. My NN bytecode? 5.5KB.

Solution: chunked writes. Split into 7 transactions. Write to account with offset.

Had to modify the Solana Python program itself to support offset writes. Added ~10 lines of C.

---

**5/**
Compute budget is CRITICAL.

Forgot to request heap frame once → instant crash.
Used script mode instead of bytecode → 10x slower.

Always compile to bytecode. Always request 256KB heap. Always set CU limit high enough.

---

**6/**
The architecture that worked:

```
Input (6 features) → Hidden (8 neurons) → Output (1)
```

Binary classification. Price goes UP or DOWN.

65 bytes of weights. 5.5KB of bytecode. All living on Solana accounts.

---

**7/**
How inference works:

TX1: Write 6 feature bytes to account (~10K CU)
TX2: Import module → code executes automatically (~1.25M CU)

The module reads weights from /sol/2, features from /sol/3, computes, prints result.

2 transactions. ~$0.002 total.

---

**8/**
The hack that made it work:

Solana Python can't do `module.function()` calls properly. Bytecode treats it as a single name.

So instead of defining a `predict()` function... the entire NN runs on import.

`import sol_1` → boom, prediction in the logs.

---

**9/**
Performance:

- 1,247,326 compute units per inference
- ~89% of the 1.4M limit
- 2 transactions per prediction
- Cost: 0.00001 SOL (~$0.002)

Not bad for a neural network running entirely in a blockchain VM.

---

**10/**
What I learned:

1. Solana Python is real but raw. Expect to patch things.
2. Bytecode mode only. Script mode is for demos.
3. Chunked writes are your friend for anything >1KB.
4. The VFS (Virtual File System) for account access actually works well.
5. On-chain ML is possible. Barely. But possible.

---

**11/**
Is this practical?

For simple models (perceptrons, small NNs, decision trees) → yes.
For anything with >100 parameters → you'll hit CU limits fast.

But as a proof of concept? This is pretty cool.

Fully verifiable inference. No off-chain computation. Pure on-chain.

---

**12/**
What's next:

- Optimize the bytecode (currently very verbose)
- Try quantized models (int4 instead of int8)
- Maybe a price prediction oracle that's 100% on-chain?

The infra is there. It's just waiting for the right use case.

---

**13/**
TL;DR:

Deployed Solana Python on DevNet.
Built a 6→8→1 neural network.
Runs fully on-chain.
~$0.002 per prediction.
1.25M compute units.
It works.

Sometimes you just have to push the tech to see what's possible.

---

**14/**
Code is messy but it works. DM if you want to see the repo.

And if you're building on-chain ML stuff, let's talk. This rabbit hole goes deep.

/thread

---

## Quick Stats for Reference

| Metric | Value |
|--------|-------|
| Architecture | 6→8→1 |
| Weights | 65 bytes |
| Bytecode | 5,579 bytes |
| CU per inference | 1,247,326 |
| Cost per inference | ~$0.002 |
| Transactions | 2 per prediction |
| Program | SolanaPython (custom deployed) |
| Network | Devnet |
