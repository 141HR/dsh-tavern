// 大肥鱼卡内插件（浏览器侧）：用 registerStageView 画 Galgame 式舞台。
// 背景、服装立绘、背景音乐都来自宿主侧导演定下的场景；翻页、自动、输入框和音乐播放仍由 Tavern 负责。
window.__ModuleLoader__.load({
  id: 'dsh-card-dafeiyu-galgame',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    // SillyTavern's 28 emotions → this figure's own expressions.
    const EMOTIONS = { joy: 'joy', amusement: 'joy', excitement: 'joy', optimism: 'joy', approval: 'joy', gratitude: 'joy', relief: 'joy', admiration: 'joy', caring: 'joy',
      anger: 'anger', annoyance: 'anger', disapproval: 'anger', sadness: 'sad', grief: 'crying', disappointment: 'sad', remorse: 'sad',
      nervousness: 'anxious', fear: 'anxious', confusion: 'anxious', surprise: 'anxious', neutral: 'calm', curiosity: 'calm', realization: 'calm',
      embarrassment: 'shy', disgust: 'disgust', love: 'love', desire: 'love', pride: 'smug' }

    function useScene(ui, gameId, turn) {
      const [scene, setScene] = React.useState(null)
      const [version, setVersion] = React.useState(0)
      React.useEffect(() => ui.watchTurnState(gameId, () => setVersion(value => value + 1)), [gameId])
      React.useEffect(() => {
        let active = true
        ui.callHost('dsh-card-dafeiyu-galgame/scene', { gameId, turn: turn || 0 }).then(value => { if (active) setScene(value) }, () => {})
        return () => { active = false }
      }, [gameId, turn, version])
      return scene
    }

    // The full-body picture stands on the stage floor, its figure 88% of the stage tall; the text box covers the legs, as in a galgame.
    const FIGURE = 88
    function Standing({ picture, alt, speaking, style }) {
      const { canvas, layers, top, feet, x } = picture
      const height = FIGURE / Math.max(0.2, feet - top)
      const box = { ...style, height: height + '%', bottom: -(1 - feet) * height + '%', transform: 'translateX(' + (-x * 100) + '%)' + (speaking ? ' translateY(-4px)' : ''), pointerEvents: 'none' }
      if (!canvas) return h('div', { style: box }, h('img', { src: layers[0].url, alt, style: { display: 'block', height: '100%' } }))
      const [width, tall] = canvas
      return h('div', { style: { ...box, aspectRatio: width + ' / ' + tall } }, layers.map((layer, at) => h('img', { key: at, src: layer.url, alt: at ? '' : alt,
        style: { position: 'absolute', left: layer.rect[0] / width * 100 + '%', top: layer.rect[1] / tall * 100 + '%', width: layer.rect[2] / width * 100 + '%', height: layer.rect[3] / tall * 100 + '%' } })))
    }

    function Stage({ ui, gameId, stage, beats, index, beat, fullscreen, advance, footer }) {
      const scene = useScene(ui, gameId, beat && beat.turn)
      // Tavern plays the music and owns the player's switch; it stops when this game's stage goes away.
      const track = scene && scene.music
      React.useEffect(() => { if (scene) ui.playMusic(track ? { url: track.url, title: track.name } : '') }, [gameId, scene && (track ? track.url : '')])
      const figure = scene && scene.figure
      let emotion = figure ? figure.defaultEmotion : 'calm'
      for (const item of beats.slice(0, index + 1)) if (figure && item.kind === 'line' && figure.names.includes(item.speaker)) emotion = EMOTIONS[item.emotion] || figure.defaultEmotion
      const speaking = beat && beat.kind === 'line' && figure && figure.names.includes(beat.speaker)
      const standing = figure && figure.standing && (figure.standing[emotion] || figure.standing[figure.defaultEmotion])
      const portrait = !standing && figure && (figure.avatars[emotion] || figure.avatars[figure.defaultEmotion])
      const figureStyle = { position: 'absolute', left: '50%', transition: 'transform .3s', filter: beat && beat.kind === 'line' && !speaking ? 'brightness(.75)' : 'none' }
      return h('div', { onClick: advance, style: { position: 'relative', height: fullscreen ? '100%' : 360, minHeight: 260, overflow: 'hidden', borderRadius: fullscreen ? 0 : 8, cursor: 'pointer', color: '#fff', background: '#1d2433' } },
        scene && scene.background ? h('img', { src: scene.background.url, alt: '', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } }) : null,
        scene && scene.background ? h('div', { style: { position: 'absolute', top: 10, left: 12, fontSize: 12, padding: '2px 10px', borderRadius: 12, background: 'rgba(0,0,0,.4)' } },
          scene.background.name + (scene.music ? ' · ♪ ' + scene.music.name : '')) : null,
        standing ? h(Standing, { picture: standing, alt: figure.names[0], speaking, style: figureStyle }) : null,
        portrait ? h('img', { src: portrait, alt: figure.names[0], style: { ...figureStyle, bottom: 96, transform: 'translateX(-50%)' + (speaking ? ' translateY(-4px)' : ''), maxHeight: '62%', maxWidth: '80%', objectFit: 'contain' } }) : null,
        // A fixed-height box: the pager stays put however long the line is; a long line scrolls inside.
        h('div', { style: { position: 'absolute', left: 12, right: 12, bottom: 12, height: fullscreen ? 168 : 128, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', padding: '10px 14px', borderRadius: 8, background: 'rgba(10,20,40,.72)' } },
          beat && beat.kind === 'line' ? h('div', { style: { flex: 'none', fontWeight: 600, marginBottom: 4, color: speaking ? '#8fb7ff' : '#fff' } }, beat.speaker) : null,
          h('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', lineHeight: 1.6, fontStyle: beat && beat.kind === 'narration' ? 'italic' : 'normal' } }, beat ? beat.text : '还没有可以演出的正文'),
          footer))
    }

    return {
      name: 'dsh-card-dafeiyu-galgame',
      inject: ['tavernUi'],
      apply(ctx) {
        const ui = ctx.tavernUi
        if (typeof ui.registerStageView !== 'function' || typeof ui.playMusic !== 'function') return
        ui.registerStageView({ id: 'galgame', label: '大肥鱼舞台', render: input => h(Stage, { ui, ...input }) })
      },
    }
  },
})
