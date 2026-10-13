# SimuVR — Noite Tuning

Simulador de carro em **VR (WebXR)** numa cidade noturna de **cultura tuning**: ponto de encontro com
carros modificados, garagem de tuning que muda a física de verdade, volante agarrável com as mãos e
física de veículo própria (pneu Pacejka, turbo, câmbio, diferencial). Feito com **Three.js** + **Rapier**,
rodando no navegador do **Meta Quest 3/3S** e no PC.

> **Estado:** todos os recursos abaixo estão implementados e cobertos por testes automatizados
> (137 unitários + 6 suítes E2E, incluindo VR emulado). **Ainda não foi testado num Quest real**: desempenho,
> conforto e a sensação do volante precisam ser validados no aparelho (veja [docs/QUEST.md](docs/QUEST.md)).

## Início rápido

```bash
npm install
npm run dev          # https://localhost:5173 (certificado autoassinado, exigido pelo WebXR)
```

**No Quest:** o navegador só abre WebXR em HTTPS.

1. Mesma rede Wi‑Fi: abra `https://<IP-do-PC>:5173` no navegador do Quest, aceite o aviso do certificado.
2. Ou por cabo: `adb reverse tcp:5173 tcp:5173` e abra `https://localhost:5173`.
3. Ou publique no GitHub Pages (workflow incluso) e abra a URL pública.

Toque em **Entrar em VR**. O Quest começa no tier de qualidade **baixo**; o PC, no **alto** (seletor na tela inicial).

## Controles

| Ação | PC | VR (Quest) |
|---|---|---|
| Acelerar / frear | `W`/`S` ou ↑/↓ · gatilhos do gamepad | gatilho **direito** / **esquerdo** (analógicos) |
| Direção | `A`/`D` ou ←/→ · analógico | **agarre o volante** (grip) e gire a mão; ou stick esquerdo (modo analógico) |
| Freio de mão | `Espaço` | botão **X** (esquerdo) |
| Marcha +/− | `Shift` / `Ctrl` (ou `E`/`Q`) | **A** / **B** (direito) |
| Câmera | `C` (perseguição, distante, capô, cockpit) | — |
| Garagem | `G` | `Y` → menu → *Garagem de tuning* |
| Menu | — | `Y` (toque) |
| Sair do carro | — | segurar `Y` por 1 s (parado) |
| A pé | — | stick esq.: andar · stick dir.: girar em passos · empurrar stick dir. p/ frente: teleporte · `A`: entrar no carro |
| Recentrar banco | — | clique no stick esquerdo |
| Reposicionar carro | `R` | — |
| Mudo · debug | `M` · `F3` | menu mostra fps / draw calls |

## Como funciona

**Física do veículo** (`src/physics/vehicle`, detalhes em [docs/FISICA.md](docs/FISICA.md)): o Rapier cuida só
do corpo rígido, das colisões e dos raios; o resto é nosso. Suspensão por raycast com barra estabilizadora e
batente, pneu **Pacejka (Magic Formula)** com escorregamento combinado e sensibilidade à carga, motor com
curva de torque + **turbo com lag** + limitador, câmbio automático/manual, embreagem, **diferencial**
aberto/LSD/travado, aerodinâmica. Motor, embreagem, diferencial e rodas são resolvidos juntos num sistema
implícito, o que mantém tudo estável a baixa velocidade e em lançamentos.

**Tuning que muda a física** (`src/physics/tuning.ts`): rebaixamento, molas, amortecedores, barras, cambagem,
composto de pneu (dianteiro/traseiro), turbo, ECU, escape, peso, relações, diferencial, freios, ângulo de
esterço e aerofólio viram parâmetros físicos por uma função pura (`resolveVehicleParams`). Mais potência em
pneu de rua só faz patinar; pneu de drift cede cedo e é fácil de segurar. Está tudo testado em simulação.

**VR** (`src/xr`): o rig é calibrado nos olhos do motorista; o volante é agarrável (uma ou duas mãos,
ângulo relativo ao ponto de pegada, batente, retorno proporcional à velocidade) e vibra com derrapagem,
limitador e batidas. Menu e garagem são painéis em canvas com raio laser.

**Cidade** (`src/city`): gerada por semente, determinística. Prédios instanciados com janelas acesas no
shader, letreiros neon em PT‑BR, postes, ruas molhadas, ponto de encontro com palco, vagas e 18 carros
tunados (todos instanciados). Neon e brilho são halos aditivos (bloom falso), porque pós-processamento não
funciona no caminho WebXR.

**Áudio** (`src/audio`): 100% procedural (sem arquivos licenciados): motor por síntese aditiva, turbo,
blow‑off, estouros, pneus, vento e música do encontro espacializada no palco.

## Desempenho (meta: Quest 3 a 72 Hz)

Medido pelo teste `test:e2e:quality` (quadro mono; em VR são dois olhos):

| Tier | Draw calls | Triângulos | Luzes | Extras |
|---|---|---|---|---|
| **Baixo** (Quest) | 66 | ~85 mil | 2 | sem SpotLights, sem verniz, sem retrovisor/chuva, fumaça 48 |
| **Alto** (PC) | 68 | ~122 mil | 4 | faróis reais, verniz, retrovisor, chuva, fumaça 110 |

Foveated rendering no máximo, escala de framebuffer 0,8 (baixo), 72 Hz. Em VR um **governador de
desempenho** (`src/core/perfGovernor.ts`) desliga recursos por etapas se o headset ficar abaixo da taxa
(nível 1 retrovisor e chuva → 2 faróis reais e metade da fumaça → 3 partículas e reflexo de ambiente nos prédios) e
reativa com folga. Para ajustar no aparelho há parâmetros de URL (`?scale=0.7&fove=1&rate=90`, veja [docs/QUEST.md](docs/QUEST.md)).

## Testes

```bash
npm run typecheck
npm test                 # 137 testes unitários (física a 120/90/60 Hz, tuning, cidade, volante, garagem, áudio, desempenho)
npm run test:e2e         # Chromium headless: PC, qualidade, garagem, áudio/efeitos, VR emulado e VR a pé
```

Os E2E usam WebGL por software e **IWER** (emulador de Meta Quest 3): entram em VR, aceleram com o gatilho,
giram a mão no aro do volante e clicam no menu por raio laser. O áudio é verificado renderizando o motor
offline e medindo a frequência (dobrar a rotação dobra o tom). **Não substituem** o teste no aparelho.

## Estrutura

```
src/
  core/      renderer, loop de passo fixo, entrada, câmeras, qualidade, governador de desempenho
  physics/   mundo Rapier, vehicle/ (pneu, motor, turbo, câmbio, diferencial, suspensão), tuning, estatísticas
  car/       geometria procedural, carro do jogador, carros instanciados, instrumentos e retrovisor
  city/      layout determinístico, prédios, letreiros, postes, ruas, ponto de encontro, céu
  xr/        sessão, rig, volante agarrável, locomoção, painéis, haptics
  garage/    estado, esquema de controles, persistência (usado pelo PC e pela VR)
  audio/     síntese do motor, ambiente, música do encontro
  fx/        fumaça, marcas, chamas, faíscas, luzes do carro, chuva
tests/       unit/ (vitest) e e2e/ (Playwright + IWER)
```

## Deploy

`.github/workflows/pages.yml` publica no GitHub Pages ao dar push na `main` (ative *Settings → Pages →
Source: GitHub Actions*). O `base` do Vite é relativo, então funciona em qualquer subcaminho.

## Solução de problemas

- **"Entrar em VR" desabilitado:** WebXR exige HTTPS (ou `localhost`). Veja o início rápido.
- **Aviso de certificado no Quest:** é o certificado autoassinado do dev server; aceite e continue.
- **Sem som:** o navegador só libera áudio após um clique; use o botão da tela inicial.
- **Quadros caindo:** escolha *Baixa* no seletor da tela inicial; o menu de VR mostra fps e draw calls.
- **Volante gira no sentido errado ao agarrar:** recentre (clique no stick esquerdo) com o volante à sua frente.

## Créditos e licenças

Nenhum modelo, textura ou áudio de terceiros: carros, cidade, letreiros e sons são gerados por código.
Bibliotecas: [three](https://threejs.org) (MIT), [Rapier](https://rapier.rs) (Apache‑2.0), Vite (MIT);
em desenvolvimento: Vitest, Playwright, IWER (MIT). Os nomes de marcas na cidade e o carro **Hanabi 200S**
são fictícios.
