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
    console.log(`1`)

    startGame(roomId)
  }

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    const room = rooms[data.roomId];
    if (!room) return;

    const playerIndex = data.playerIndex;

    /*
    if (data.type === 'reach') {
      const shoupai = room.shoupais[playerIndex];
      const shanten = Majiang.Util.xiangting(shoupai);

      if (shanten === 0) {
        room.players.forEach((player) => {
          if (player.readyState === 1) {
            player.send(JSON.stringify({
              type: 'reachResult',
              playerIndex,
              result: 'OK'
            }));
          }
        });
      } else {
        if (room.players[playerIndex].readyState === 1) {
          room.players[playerIndex].send(JSON.stringify({
            type: 'reachResult',
            playerIndex,
            result: 'NG',
            message: 'リーチはできません（シャンテン数が0ではない）'
          }));
        }
      }
      return;
    }
*/
    if (data.type === 'reach') {
      const playerIndex = data.playerIndex;
      const room = rooms[data.roomId];
      if (!room) return;

      const shoupai = room.shoupais[playerIndex];
      const reachInfo = Majiang.Util.reach(shoupai);

      let result, tingpaiList = [];

      if (reachInfo && reachInfo.dapai && reachInfo.dapai.length > 0) {
        tingpaiList = reachInfo.dapai.map(p => {
          const pstr = p.replace(/[+\-*]/g, '');
          return convertMPSZToPaiIndex(pstr);
        });

        result = 'OK';
      } else {
        result = 'NG';
      }

      room.players[playerIndex].send(JSON.stringify({
        type: 'reachResult',
        result,
        message: result === 'OK' ? '' : 'リーチできません',
        tingpaiList
      }));
      return;
    }

    if (data.type === 'dahai') {
      const shoupai = room.shoupais[playerIndex];
      const paiStr = convertPaiIndexToMPSZ(data.pai);
      shoupai.dapai(paiStr);

      const opponentIndex = (playerIndex + 1) % 2;
      const oppShoupai = room.shoupais[opponentIndex];

      const ronResult = Majiang.Util.hule(
        oppShoupai,
        paiStr + '-',
        Majiang.Util.hule_param({
          zhuangfeng: 0,
          menfeng: opponentIndex,
          baopai: null,
          changbang: 0,
          lizhibang: 0,
        })
      );

      if (ronResult) {
        room.players[opponentIndex].send(JSON.stringify({
          type: 'ronCheck',
          pai: data.pai,
          fromPlayer: playerIndex,
          roomId: data.roomId
        }));
        return;
      }

      // 通常の打牌通知
      room.players.forEach((player, i) => {
        if (player.readyState === 1) {
          player.send(JSON.stringify({
            type: 'dahai',
            playerIndex,
            pai: data.pai
          }));
        }
      });

      // 次のターン処理
      room.currentTurn = (room.currentTurn + 1) % 2;
      const nextPlayer = room.players[room.currentTurn];

      if (room.mountain.length > 0) {
        const nextPai = room.mountain.shift();
        const nextPaiStr = convertPaiIndexToMPSZ(nextPai);
        room.shoupais[room.currentTurn].zimo(nextPaiStr);

        const currentShoupai = room.shoupais[room.currentTurn];

        // ツモ和了の判定
        const tsumoResult = Majiang.Util.hule(
          currentShoupai,
          null,
          Majiang.Util.hule_param({
            zhuangfeng: 0,
            menfeng: room.currentTurn,
            baopai: null,
            changbang: 0,
            lizhibang: 0,
          })
        );

        if (nextPlayer.readyState === 1) {
          nextPlayer.send(JSON.stringify({
            type: 'tsumo',
            playerIndex: room.currentTurn,
            roomId: data.roomId,
            handString: currentShoupai.toString()
          }));


          const shanten = Majiang.Util.xiangting(currentShoupai);
          console.log('シャンテン:' + shanten);
          if (shanten === 0) {
            nextPlayer.send(JSON.stringify({
              type: 'reachable',
              roomId: data.roomId,
              playerIndex: room.currentTurn
            }));
          }

          if (tsumoResult) {
            nextPlayer.send(JSON.stringify({
              type: 'tsumoCheck',
              roomId: data.roomId,
              playerIndex: room.currentTurn
            }));
          }
        }
      } else {
        console.log('🈳 山が尽きました（流局）');
      }
    }

    // 👇 追加：ロン要求を受けたときの処理
    if (data.type === 'ron') {
      const winner = data.playerIndex;
      room.players.forEach((player, i) => {
        if (player.readyState === 1) {
          player.send(JSON.stringify({
            type: 'ron',
            winner,
            pai: data.pai
          }));
        }
      });
      console.log('あがり（ユーザー操作によるロン）');
      // 対局終了処理は必要に応じてここで
    }
    if (data.type === 'skip') {
      // 通常の打牌後の処理と同じようにツモへ
      room.currentTurn = (room.currentTurn + 1) % 2;
      const nextPlayer = room.players[room.currentTurn];

      if (room.mountain.length > 0) {
        const nextPai = room.mountain.shift();
        const nextPaiStr = convertPaiIndexToMPSZ(nextPai);
        room.shoupais[room.currentTurn].zimo(nextPaiStr);

        if (nextPlayer.readyState === 1) {
          nextPlayer.send(JSON.stringify({
            type: 'tsumo',
            playerIndex: room.currentTurn,
            roomId: data.roomId,
            handString: room.shoupais[room.currentTurn].toString()
          }));
        }
      } else {
        console.log('🈳 山が尽きました（流局）');
      }
    }
    if (data.type === 'tsumo') {
      const winner = data.playerIndex;
      room.players.forEach((player, i) => {
        if (player.readyState === 1) {
          player.send(JSON.stringify({
            type: 'tsumo',
            winner,
            pai: null // ツモは捨て牌が無い
          }));
        }
      });
      console.log('あがり（ツモ）');
    }
    if (data.type === 'tsumo') {
      const winner = data.playerIndex;
      room.players.forEach((player, i) => {
        if (player.readyState === 1) {
          player.send(JSON.stringify({
            type: 'tsumo',
            winner,
            pai: null
          }));
        }
      });
      console.log('あがり（ツモ）');
    }

    if (data.type === 'log') {
      console.log(`🪵 クライアントログ: ${data.message}`);
      return; // 他の処理に進まないよう終了
    }
  });


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
  const tiles = Array.from({ length: 136 }, (_, i) => i);
  shuffle(tiles);
  console.log(`4`)


  // 🔧 テスト用固定牌構成
  const fixedHand0 = [0, 1, 2, 4, 8, 12, 36, 40, 44, 108, 109, /*予備:*/ 5, 6]; // プレイヤー0
  const fixedHand1 = [96, 100, 104, 32, 36, 40, 4, 8, 12, 110, 111, /*補完:*/ 33, 34]; // プレイヤー1 (即ロン用)
  const hands = [fixedHand0, fixedHand1]


  //const hands = [tiles.slice(0, 13), tiles.slice(13, 26)];
  const mountain = [108, ...tiles.slice(27)];
  const shoupais = [];

  for (let i = 0; i < 2; i++) {
    const handString = convertPaiArrayToStringSorted(hands[i]); // → m123p456z77 形式
    console.log(handString);
    const sp = Majiang.Shoupai.fromString(handString);
    shoupais.push(sp);
    console.log(`配牌 ${i}:`, sp.toString());
  }
  console.log(`5`)
  // 先手（player 0）にもう1枚ツモ
  const firstDraw = mountain.shift();
  shoupais[0].zimo(convertPaiIndexToMPSZ(firstDraw));

  console.log(`6`)
  // 状態をルームに保存
  room.shoupais = shoupais;
  room.mountain = mountain;
  room.currentTurn = 0;
  console.log(`7`)
  // クライアントに初期手牌を送信
  room.players.forEach((player, i) => {
    const shoupai = shoupais[i];

    player.send(JSON.stringify({
      type: 'start',
      playerIndex: i,
      roomId,
      handString: shoupai.toString()
    }));

    // 👇 先手（プレイヤー0）のみツモチェック
    if (i === 0) {
      const tsumoResult = Majiang.Util.hule(
        shoupai,
        null,
        Majiang.Util.hule_param({
          zhuangfeng: 0,
          menfeng: i,
          baopai: null,
          changbang: 0,
          lizhibang: 0
        })
      );

      if (tsumoResult) {
        player.send(JSON.stringify({
          type: 'tsumoCheck',
          roomId,
          playerIndex: i
        }));
      }
    }

    const shanten = Majiang.Util.xiangting(shoupai);

    player.send(JSON.stringify({
      type: 'start',
      playerIndex: i,
      roomId,
      handString: shoupai.toString()
    }));
    console.log('シャンテン:' + shanten);
    if (i === 0 && shanten === 0) { // 後手はまだツモってないのでリーチ不可能
      player.send(JSON.stringify({
        type: 'reachable',
        roomId,
        playerIndex: i
      }));
    }
  });
}


function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[array[i], array[j]] = [array[j], array[i]]
  }
}

function convertPaiIndexToMPSZ(pai) {
  const typeIndex = Math.floor(pai / 4);
  if (typeIndex < 9) return 'm' + (typeIndex + 1);
  if (typeIndex < 18) return 'p' + (typeIndex - 9 + 1);
  if (typeIndex < 27) return 's' + (typeIndex - 18 + 1);
  return 'z' + (typeIndex - 27 + 1);
}

function convertShoupaiToArray(shoupai) {
  const result = []
  const allPai = shoupai._bingpai
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

function convertMPSZToPaiIndex(paiStr) {
  const num = parseInt(paiStr[1]);
  const suit = paiStr[0];
  let base = 0;
  if (suit === 'p') base = 9;
  else if (suit === 's') base = 18;
  else if (suit === 'z') base = 27;
  const tileIndex = base + num - 1;
  return tileIndex * 4; // 最初の牌
}

function convertPaiArrayToStringSorted(paiArray) {
  const paiCounts = {
    m: Array(9).fill(0),
    p: Array(9).fill(0),
    s: Array(9).fill(0),
    z: Array(7).fill(0)
  };

  for (const pai of paiArray) {
    const typeIndex = Math.floor(pai / 4);
    if (typeIndex < 9) paiCounts.m[typeIndex]++;
    else if (typeIndex < 18) paiCounts.p[typeIndex - 9]++;
    else if (typeIndex < 27) paiCounts.s[typeIndex - 18]++;
    else paiCounts.z[typeIndex - 27]++;
  }

  let result = '';

  for (const suit of ['m', 'p', 's']) {
    const tiles = paiCounts[suit];
    let suitStr = '';
    for (let i = 0; i < tiles.length; i++) {
      suitStr += String(i + 1).repeat(tiles[i]);
    }
    if (suitStr !== '') result += suit + suitStr;
  }

  const honors = paiCounts.z;
  let honorStr = '';
  for (let i = 0; i < honors.length; i++) {
    honorStr += String(i + 1).repeat(honors[i]);
  }
  if (honorStr !== '') result += 'z' + honorStr;

  return result;
}