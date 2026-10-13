# Física do veículo

Tudo em `src/physics/vehicle/`. Passo fixo de 120 Hz (90 Hz no tier baixo), com interpolação na renderização.
O Rapier fornece o corpo rígido, colisões e raycasts; **nenhuma** força de veículo vem do Rapier.

Convenção: referencial do chassi com origem no centro de massa, **+X direita, +Y cima, −Z frente**.

## Pipeline de um passo (`Vehicle.update`)

1. Lê o estado do corpo; calcula velocidades, aceleração em g.
2. Interpreta pedais (em ré o "acelerador" é o freio), câmbio automático, esterço (Ackermann).
3. **Suspensão:** um raio por roda a partir do ponto de fixação. Compressão `x`, velocidade de compressão `v`
   (velocidade do ponto projetada no eixo, imune ao serrilhado do raio). Força `k·x + c·v` (amortecimento
   assimétrico bump/rebound) + batente progressivo + barra estabilizadora acoplando as duas rodas do eixo.
4. **Pneus:** velocidade do ponto de contato → `vlong`, `vlat`; `κ = (ωR − vlong)/max(|vlong|, 3)`,
   ângulo de deriva filtrado (relaxamento de ~0,4 m). Forças pela Magic Formula normalizada com
   escorregamento combinado `ρ = √(κ_n² + α_n²)`, atrito dependente da carga (`μ(Fz)`), escala por superfície
   e cambagem. Abaixo de ~2,4 m/s mistura um modelo viscoso (sem tremor/deslize parado). O resultado é
   limitado à elipse de atrito. Torque auto-alinhante alimenta o retorno do volante e a vibração.
5. **Powertrain implícito:** o sistema `[Δω_motor, Δω_esq, Δω_dir]` é resolvido por Gauss (3×3) com a derivada
   numérica da força do pneu e o travamento do diferencial. Explícito é instável em baixa velocidade (rigidez
   do pneu × inércia da roda); implícito não é.
6. **Embreagem automática:** capacidade proporcional ao torque do motor × fator de erro de rotação em relação
   a uma rotação-alvo (maior com acelerador). Em regime transmite exatamente o torque do motor (lançamento
   controlado); ao igualar as rotações, trava. É de primeira ordem: não oscila nem "caça".
7. Aplica impulsos ao chassi: apoio na **normal do solo** no ponto de contato (no eixo do chassi surge uma
   componente horizontal espúria com arfagem de equilíbrio e o carro parado "andaria"), forças do pneu no
   plano de contato, arrasto e pressão aerodinâmica.

## Parâmetros que o tuning altera

| Tuning | Efeito físico |
|---|---|
| Rebaixamento | encurta a extensão da mola e o curso; CG desce; assoalho chega mais perto do chão |
| Molas / amortecedores / barras | `k`, `c` (a partir do amortecimento crítico), rigidez da barra por eixo |
| Cambagem | atrito lateral `1 + 0,03c − 0,0045c²`, longitudinal `1 − 0,006c` (c em graus negativos) |
| Pneus | `μ`, pico de escorregamento, forma da curva (C, E), relaxamento — por eixo |
| Turbo / ECU / escape | pressão máx., lag, rotações de spool, ganho de torque `1 + 0,9·boost` |
| Peso | massa (CG fixo) |
| Relações / final | razão total |
| Diferencial | pré-carga e fração de travamento em potência/aceleração e desaceleração |
| Freios | torque total e balanço dianteiro |
| Esterço | ângulo máximo da roda interna |
| Aerofólio | pressão e arrasto |

`resolveVehicleParams(spec, tuning)` é pura e testada (monotonicidade, limites, embreagem dimensionada).

## Calibração (carro padrão "Hanabi 200S", 1250 kg, ~260 cv)

Verificada em simulação headless: assenta parado sem deslizar; 0–100 km/h em 4,5–8 s; 100–0 em 30–50 m com
ABS; ~1 g lateral em pneu de rua (semi‑slick acima, pneu de drift abaixo); velocidade final 200–285 km/h;
freio de mão em curva gera mais de 20° de deriva; 30 s de entradas aleatórias mantêm tudo finito; e o
resultado é o mesmo a 120, 90 e 60 Hz (o tier baixo roda a 90 Hz).

**Derrapagem sustentável** (`vehicle.drift.test.ts`): um motorista simples (PD no ângulo de deriva) tenta segurar
~20° numa curva à direita, em 144 combinações de ganho/acelerador/velocidade. Segura mais de 4 s sem rodar:
**54%** com o preset de drift (diferencial travado, pneu traseiro de drift, kit de ângulo), **15%** com o carro
original (diferencial aberto, pneus de rua) e **6%** com semi-slick atrás. Ou seja, o tuning de drift torna o
carro de fato conduzível em derrapagem, e escolher pneu de aderência o torna difícil, como na vida real.

## Limitações conhecidas

- Sem desgaste/temperatura de pneu e sem dano.
- A reação do torque do motor no chassi não é modelada (o agachamento vem das forças do pneu).
- Um carro simulado por vez (os do encontro são estáticos); tração traseira (o código aceita dianteira).
- O ajuste fino do "feeling" (especialmente do drift com volante físico em VR) pede iteração no aparelho.
