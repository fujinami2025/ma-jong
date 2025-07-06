const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001

app.use(express.static('public'))

// プレイヤー待機用
let waitingPlayers = []
let roomCounter = 1
let waitingCount = 0 // ログ出力用に明示
const rooms = {}
app.ws('/ws', (ws, req) => {
  console.log('🔌 新しいクライアントが接続しました')

  waitingPlayers.push(ws)
  waitingCount++
  console.log(`🧍 現在の待機人数: ${waitingCount}`)

  // 待機人数を通知（クライアント側で受信して表示に使える）
  waitingPlayers.forEach((player) => {
    if (player.readyState === 1) {
      player.send(JSON.stringify({ type: 'waiting', count: waitingPlayers.length }))
    }
  })

  // 2人揃ったらゲーム開始
if (waitingPlayers.length >= 2) {
  const roomId = `room-${roomCounter++}`
  const players = waitingPlayers.splice(0, 2)
  waitingCount -= 2

  console.log(`🎮 ルーム作成: ${roomId} で 2人の対戦を開始します`)

  // ここでルーム情報を保存
  rooms[roomId] = {
    players
  };

  // 対戦開始メッセージ送信
  players.forEach((player, index) => {
    if (player.readyState === 1) {
      player.send(JSON.stringify({ type: 'start', playerIndex: index, roomId }))
    }
  });

  // 対戦開始処理
  startGame(roomId);
}

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
  const room = rooms[roomId];
  let tiles = Array.from({ length: 136 }, (_, i) => i);
  shuffle(tiles);

const hands = [
  tiles.slice(0, 13).sort((a, b) => a - b),     // プレイヤー1の手牌（昇順）
  tiles.slice(13, 26).sort((a, b) => a - b)     // プレイヤー2の手牌（昇順）
];

  room.players.forEach((player, i) => {
    player.send(JSON.stringify({
      type: 'start',
      playerIndex: i,
      roomId,
      hand: hands[i]
    }));
  });

  room.hands = hands;
  room.currentTurn = 0;
  console.log('手牌:', hands);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}