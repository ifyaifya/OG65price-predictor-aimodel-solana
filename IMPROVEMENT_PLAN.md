# Price Predictor - Plan d'Amélioration

## État Actuel (Validé sur Devnet)

```
┌─────────────────────────────────────────────────────────────────┐
│ Architecture: 4→3→2 (23 params)                                │
├─────────────────────────────────────────────────────────────────┤
│ TX1 (Encoder)  │ 892 bytes  │ 128,302 CU  │ 4 in → 3 hidden    │
│ TX2 (Decoder)  │ 567 bytes  │ 128,032 CU  │ 3 hidden → 2 out   │
├─────────────────────────────────────────────────────────────────┤
│ Total          │ 1,459 bytes│ ~256K CU    │ 23 params INT8     │
│ Tests          │ 4/4 passed │             │                    │
└─────────────────────────────────────────────────────────────────┘
```

**Features actuelles (4):**
- vwap_ratio (VWAP / prix actuel)
- volume_accel (accélération volume)
- orderbook_imbal (déséquilibre orderbook)
- momentum (tendance récente)

---

## Limitations Identifiées

### 1. Limite Bytecode (946 bytes/TX)
- **Problème:** 6 inputs génère 1454 bytes (>946)
- **Cause:** Chaque multiplication ajoute ~50 bytes de bytecode
- **Impact:** Limité à 4 features par TX

### 2. Poids Aléatoires
- **Problème:** Les tests utilisent des poids random
- **Impact:** Pas de prédiction réelle
- **Solution:** Entraîner un vrai modèle

### 3. Pas de Validation Output
- **Problème:** On vérifie seulement que l'exécution réussit
- **Impact:** Pas de test de la qualité des prédictions

---

## Plan d'Amélioration

### Phase 1: Entraînement Réel

**1.1 Collecte de Données**
```
Sources:
├── Pyth Network → Prix temps réel
├── Jupiter API → Prix agrégés
└── Birdeye API → Historique trades

Dataset target:
├── 10,000+ samples
├── Labels: direction 5-30 slots après
└── Format: [features] → direction (-1, 0, +1)
```

**1.2 Pipeline Training**
```bash
# Exécuter le training
cd src/scripts
python train.py --samples 10000 --epochs 200 --output trained_weights.bin

# Export poids INT8
# → trained_weights_encoder.bin (19 bytes: 15 weights + 4 inputs)
# → trained_weights_decoder.bin (8 bytes)
```

**1.3 Validation Offline**
- Target: >55% accuracy (mieux que random 50%)
- Cross-validation 5-fold
- Backtesting sur données unseen

---

### Phase 2: Architecture 6 Features (3 TX)

Pour revenir aux 6 features originaux, utiliser 3 transactions:

```
┌─────────────────────────────────────────────────────────────────┐
│ Architecture 3-TX: 6→3→2 (26 params)                           │
├─────────────────────────────────────────────────────────────────┤
│ TX1 (Encoder 1/2) │ ~600 bytes │ Inputs 0-2 → partials h0,h1  │
│ TX2 (Encoder 2/2) │ ~700 bytes │ Inputs 3-5 → combine + ReLU  │
│ TX3 (Decoder)     │ ~570 bytes │ 3 hidden → 2 outputs         │
├─────────────────────────────────────────────────────────────────┤
│ Total             │ ~1,870 bytes│ ~384K CU   │ 3 TX           │
└─────────────────────────────────────────────────────────────────┘
```

**Fichiers à créer:**
```
src/python/
├── price_6_3_s1a.py  # Encoder part 1: inputs 0-2
├── price_6_3_s1b.py  # Encoder part 2: inputs 3-5 + combine
└── price_6_3_s2.py   # Decoder
```

**Features 6:**
1. vwap_ratio
2. volume_accel
3. orderbook_imbal
4. volatility
5. liquidity
6. momentum

---

### Phase 3: Amélioration Output

**3.1 Interprétation Direction**
```javascript
// Decoder output: direction * 1000 + confidence
const raw = decoderResult;
const direction = Math.floor(raw / 1000);
const confidence = raw % 1000;

// Interpretation
if (direction > 20) return "BULLISH";
if (direction < -20) return "BEARISH";
return "NEUTRAL";
```

**3.2 Seuils de Confiance**
```javascript
const CONFIDENCE_THRESHOLD = 150; // 0-255

function shouldAct(direction, confidence) {
  return confidence > CONFIDENCE_THRESHOLD;
}
```

**3.3 Test avec Validation**
```javascript
// Test case avec validation output
{
  name: "Strong bullish",
  features: [160, 180, 155, 175],
  expectedDirection: 1,    // +1 = bullish
  expectedConfidence: 150, // minimum
  validate: (result) => {
    const dir = Math.floor(result / 1000);
    return dir > 20;
  }
}
```

---

### Phase 4: Optimisations

**4.1 Réduire Bytecode**
```python
# Avant: 892 bytes
h0=W[12]+W[15]*W[0]+W[16]*W[3]+W[17]*W[6]+W[18]*W[9]

# Optimisation potentielle: boucles
# (mais peut être plus lent en CU)
```

**4.2 Réduire CU**
- Éviter les conversions signed si possible
- Utiliser unsigned quand c'est safe
- Pré-calculer certaines valeurs

**4.3 Combiner Stages**
- Si les deux stages tiennent dans une TX (< 946 bytes total)
- Réduire à 1 TX au lieu de 2

---

### Phase 5: SDK & Intégration

**5.1 SDK JavaScript**
```javascript
class PricePredictor {
  // Normaliser market data en features INT8
  normalizeFeatures(data) { ... }

  // Exécuter prédiction (2 TX)
  async predict(features) { ... }

  // Interpréter résultat
  interpretResult(raw) { ... }
}
```

**5.2 Exemple Intégration DEX**
```javascript
// Avant un swap
const predictor = new PricePredictor(connection, programId);
const features = predictor.normalizeFeatures(marketData);
const result = await predictor.predict(features);

if (result.direction > 0 && result.confidence > 150) {
  console.log("Bullish signal - good time to buy");
}
```

---

## Métriques de Succès

| Métrique | Actuel | Target |
|----------|--------|--------|
| Architecture | 4→3→2 | 6→3→2 (optionnel) |
| Bytecode total | 1,459 bytes | <2,000 bytes |
| CU total | 256K | <400K |
| Accuracy | N/A (random) | >55% |
| Latency | 2 TX | 2-3 TX |
| Tests passing | 4/4 | 10/10 |

---

## Prochaines Étapes Immédiates

1. **[ ] Entraîner modèle réel**
   - Collecter données Pyth/Jupiter
   - Exécuter train.py avec vraies données
   - Valider accuracy >55%

2. **[ ] Implémenter validation output**
   - Parser le résultat decoder
   - Ajouter assertions sur direction

3. **[ ] Optionnel: Architecture 6 features**
   - Créer price_6_3_s1a.py, price_6_3_s1b.py
   - Tester 3-TX flow

4. **[ ] Documentation**
   - Mettre à jour README
   - Ajouter exemples d'intégration

---

## Notes Techniques

### Scaling Multi-TX
```
Règle: ~12 params INT8 par TX
- 2 TX → 24 params → 4 inputs × 3 hidden (4→3→2)
- 3 TX → 36 params → 6 inputs × 3 hidden (6→3→2)
- 4 TX → 48 params → 6 inputs × 4 hidden (6→4→2)
- N TX → N×12 params
```

### Bytecode Budget
```
Max par TX: 946 bytes
Budget estimé:
- File I/O: ~200 bytes
- Signed conversion: ~100 bytes
- Par multiplication: ~50 bytes
- Par ReLU: ~20 bytes
```

### CU Budget
```
Max par TX: 1,400,000 CU
Consommation typique: ~128K CU
Marge: 10x headroom
```
