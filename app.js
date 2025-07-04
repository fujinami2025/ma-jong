const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
app.use(express.static('public'))

let waitingPlayers = []
let roomCount = 0  // デバッグ用に部屋の数を表示

app.ws('/ws', (ws, req) => {
  console.log('🟢 新しい接続')
  waitingPlayers.push(ws)
  console.log(`🕒 現在の待機人数: ${waitingPlayers.length}`)

  // 接続が切れたときの処理
  ws.on('close', () => {
    waitingPlayers = waitingPlayers.filter(player => player !== ws)
    console.log('🔴 接続が切断されました')
    console.log(`🕒 現在の待機人数: ${waitingPlayers.length}`)
  })

  // 2人揃ったらルーム作成
  if (waitingPlayers.length >= 2) {
    const players = waitingPlayers.splice(0, 2)
    const roomId = `room${++roomCount}`
    console.log(`🏠 ルーム作成: ${roomId}`)
    console.log(`🕒 残り待機人数: ${waitingPlayers.length}`)

    players.forEach((player, index) => {
      player.send(JSON.stringify({
        type: 'start',
        playerIndex: index,
        roomId: roomId
      }))
    })
  }
})
