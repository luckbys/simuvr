# Testando no Meta Quest 3/3S

Nada aqui foi validado num aparelho real ainda; esta lista serve para isso e para reportar o resultado.

## Como abrir

1. **Wi‑Fi:** `npm run dev`, depois no navegador do Quest abra `https://<IP-do-PC>:5173` e aceite o certificado.
2. **Cabo (ADB):** `adb reverse tcp:5173 tcp:5173` e abra `https://localhost:5173`.
3. **Pages:** abra a URL pública do deploy.

## Checklist

**Entrada e conforto**
- [ ] "Entrar em VR" funciona e o jogo começa sentado no carro, olhos no banco do motorista.
- [ ] Clique no stick esquerdo recentra; a altura/posição fica confortável sentado e em pé.
- [ ] A vinheta de conforto aparece em curva forte e não incomoda (menu → Conforto).
- [ ] Sem enjoo evidente em 5 min dirigindo (reporte: sensibilidade e o que causou).

**Volante**
- [ ] O grip perto do aro agarra; girar a mão gira o volante sem saltos.
- [ ] Duas mãos funcionam; soltar uma não "pula" o volante.
- [ ] Retorno ao centro natural em velocidade e parado.
- [ ] O curso (360/540/720/900°) se adapta ao seu jeito; modo analógico como alternativa.
- [ ] Vibração em derrapagem/limitador/batidas é perceptível e não cansa.

**Pedais e câmbio**
- [ ] Gatilhos são analógicos (suaves). `X` = freio de mão. `A`/`B` trocam marcha (manual).

**Locomoção**
- [ ] Segurar `Y` 1 s sai do carro; teleporte em arco e giro em passos funcionam; `A` perto da porta entra.
- [ ] Não atravessa prédios nem o carro.

**Menu / garagem**
- [ ] `Y` abre o menu, o laser acerta os botões, o slider arrasta; a garagem muda o carro ao vivo.
- [ ] O menu fica legível e não some atrás do painel do carro.

**Desempenho** (menu mostra fps · draw · tris)
- [ ] 72 fps estáveis no tier baixo no ponto de encontro e dirigindo pelo centro.
- [ ] Anote em quais lugares cai: centro (muitos prédios), derrapando (fumaça), olhando o palco.
- [ ] Se aparecer `[desempenho] nível N` no console, o governador degradou; anote o quê.

## O que reportar

Modelo (3 ou 3S), versão do Browser, tier, fps nos pontos acima, o que causou enjoo/desconforto, a sensação
do volante (peso, precisão), e capturas se possível. Com isso dá para calibrar curso do volante, retorno,
vinheta e orçamento gráfico.

## Ajuste fino direto pela URL

Dá para iterar no navegador do Quest sem rebuild, acrescentando parâmetros ao endereço:

| Parâmetro | Efeito | Faixa |
|---|---|---|
| `?q=low` / `?q=high` | tier de qualidade | — |
| `&scale=0.7` | escala do framebuffer XR (resolução) | 0,5 – 1,5 |
| `&fove=1` | foveated rendering (1 = máximo) | 0 – 1 |
| `&rate=90` | taxa-alvo do headset | 60 – 144 |
| `&hz=60` | passo da física | 60 – 144 |
| `&rain=0` | desliga a chuva | 0 / 1 |

Exemplo: `https://<ip>:5173/?q=low&scale=0.7&fove=1`. Se o fps cair, comece baixando `scale` (0,8 → 0,7 → 0,6).

## Dicas

- Console remoto: `chrome://inspect` no PC com o Quest conectado por ADB.
- Para forçar o tier: `?q=low` ou `?q=high` na URL.
