const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let waitingPlayers = []

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  console.log('New connection')

  waitingPlayers.push(ws)

  if (waitingPlayers.length === 2) {
    // プレイヤーが2人揃ったら両方にstartメッセージを送る
    waitingPlayers.forEach((player, index) => {
      player.send(JSON.stringify({ type: 'start', playerIndex: index }))
    })
  }

  ws.on('message', (message) => {
    console.log('Received:', message)
    // 対戦中ロジックはここに追加
  })

  ws.on('close', () => {
    console.log('Connection closed')
    waitingPlayers = waitingPlayers.filter((conn) => conn !== ws)
  })
})

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
