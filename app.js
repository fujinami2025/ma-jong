const express = require('express')
const expressWs = require('express-ws')
const Majiang = require('@kobalab/majiang-core')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001

app.use('/dist', express.static('dist'));
app.use(express.static('public'))

let waitingPlayers = []
let roomCounter = 1
let waitingCount = 0
const rooms = {}

app.ws('/ws', (ws, req) => {
  console.log('🔌 新しいクライアントが接続しました')

  waitingPlayers.push(ws)
  waitingCount++
  console.log(`🧍 現在の待機人数: ${waitingCount}`)

  waitingPlayers.forEach((player) => {
    if (player.readyState === 1) {
      player.send(JSON.stringify({ type: 'waiting', count: waitingPlayers.length }))
    }
  })

  if (waitingPlayers.length >= 2) {
    const roomId = `room-${roomCounter++}`
    const players = waitingPlayers.splice(0, 2)
    waitingCount -= 2

    console.log(`🎮 ルーム作成: ${roomId} で 2人の対戦を開始します`)

    rooms[roomId] = {
      players,
      hands: [],
      shoupais: [],
      mountain: [],
      currentTurn: 0
    }

    startGame(roomId)
  }

  ws.on('message', (msg) => {
    const data = JSON.parse(msg)
    const room = rooms[data.roomId]
    if (!room) return

    const playerIndex = data.playerIndex

    if (data.type === 'dahai') {
      const shoupai = room.shoupais[playerIndex]
      const paiStr = convertPaiIndexToMPSZ(data.pai)
      shoupai.dapai(paiStr)

      room.players.forEach((player, i) => {
        if (player.readyState === 1) {
          player.send(JSON.stringify({
            type: 'dahai',
            playerIndex,
            pai: data.pai
          }))
        }
      })

      // 次のターンに交代
      room.currentTurn = (room.currentTurn + 1) % 2
      const nextPlayer = room.players[room.currentTurn]

      if (room.mountain.length > 0) {
        const nextPai = room.mountain.shift()
        const nextPaiStr = convertPaiIndexToMPSZ(nextPai)

        room.shoupais[room.currentTurn].zimo(nextPaiStr)

        if (nextPlayer.readyState === 1) {
          nextPlayer.send(JSON.stringify({
            type: 'tsumo',
            pai: nextPai,
            hand: convertShoupaiToArray(room.shoupais[room.currentTurn]),
            playerIndex: room.currentTurn,
            roomId: data.roomId
          }))
        }
      } else {
        console.log('🈳 山が尽きました（流局）')
      }
    }
  })

  ws.on('close', () => {
    console.log('❌ クライアントが切断されました')
    waitingPlayers = waitingPlayers.filter((p) => p !== ws)
    waitingCount--
    console.log(`🧍 現在の待機人数: ${waitingCount}`)
  })
})

app.listen(port, () => {
  console.log(`🚀 サーバー起動中: http://localhost:${port}`)
})
function startGame(roomId) {
  const room = rooms[roomId]
  let tiles = Array.from({ length: 136 }, (_, i) => i)
  shuffle(tiles)

  const hands = [tiles.slice(0, 13), tiles.slice(13, 26)]
  const mountain = tiles.slice(26)

  const shoupais = [
    new Majiang.Shoupai(),
    new Majiang.Shoupai()
  ]

  // プレイヤー0は1枚多く持つ（最初にツモる）
  const firstDraw = mountain.shift()
  hands[0].push(firstDraw)

  for (let i = 0; i < 2; i++) {
    for (const pai of hands[i]) {
      shoupais[i].zimo(convertPaiIndexToMPSZ(pai))
    }
  }

  room.hands = hands
  room.shoupais = shoupais
  room.mountain = mountain
  room.currentTurn = 0

room.players.forEach((player, i) => {
  if (player.readyState === 1) {
    player.send(JSON.stringify({
      type: 'start',
      playerIndex: i,
      roomId,
      hand: convertShoupaiToArray(shoupais[i])
    }))
  } else {
    console.warn(`⚠️ player ${i} の readyState = ${player.readyState} のため送信不可`)
  }
})

  console.log('🀄️ 初期手牌:')
  console.log('先手:', shoupais[0].toString())
  console.log('後手:', shoupais[1].toString())
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
}

function convertPaiIndexToMPSZ(pai) {
  const typeIndex = Math.floor(pai / 4)
  if (typeIndex < 9) return (typeIndex + 1) + 'm'
  if (typeIndex < 18) return (typeIndex - 9 + 1) + 'p'
  if (typeIndex < 27) return (typeIndex - 18 + 1) + 's'
  return (typeIndex - 27 + 1) + 'z'
}

function convertShoupaiToArray(shoupai) {
  const result = []
  const allPai = shoupai._bingpai // { m:[], p:[], s:[], z:[] }
  for (const suit of ['m', 'p', 's', 'z']) {
    const tiles = allPai[suit]
    for (let i = 0; i < tiles.length; i++) {
      const count = tiles[i]
      for (let j = 0; j < count; j++) {
        result.push(convertMPSZToPaiIndex((i + 1) + suit))
      }
    }
  }
  return result.sort((a, b) => a - b)
}

function convertMPSZToPaiIndex(paiStr) {
  const num = parseInt(paiStr[0])
  const suit = paiStr[1]
  let base = 0
  if (suit === 'p') base = 9
  else if (suit === 's') base = 18
  else if (suit === 'z') base = 27
  const tileIndex = base + num - 1
  return tileIndex * 4 // 常に0番目のインスタンス
}
