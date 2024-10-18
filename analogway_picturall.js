const {
	combineRgb,
	InstanceBase,
	Regex,
	runEntrypoint,
	InstanceStatus,
	CreateConvertToBooleanFeedbackUpgradeScript
} = require('@companion-module/base')

const net = require('node:net')

class Picturall extends InstanceBase {

	numPlaybacks = 8
	numLayers = 32 // number of layers can be changed by server configuration, this number is only for preset generation
	firmwareVersion = '0'
	numOutputs = 0
	numInputs = 0
	modelname = ''
	cuestacks = []
	cuestackIDs = []
	sourceplaystates = []
	objects = [{}]
	objIds = [{}]
	lastcmd = {
		object: '',
		ctrlParam: ''
	}
	shouldBeConnected = false
	socket = new net.Socket()
	timer

	constructor(internal) {
		super(internal)
		this.instanceOptions.disableVariableValidation = true
	}

	async init(config) {
		this.config = config
		this.RegexIP = new RegExp(Regex.IP.slice(1, -1))


		this.updateActions()
		this.updateVariables()
		this.updateFeedbacks()
		this.updatePresets()

		this.connectTcp()
	}
	// When module gets deleted
	async destroy() {
		if (this.socket !== undefined) {
			clearTimeout(this.timer)
			this.socket.destroy();
		}
		this.log('debug', 'destroy')
	}

	async configUpdated(config) {
		let oldhost = this.config.host
		console.log('config update ddd', oldhost, config.host);
		this.config = config
		if (config.host !== oldhost && config.host.match(this.RegexIP)) {
			// do reconnect
			this.shouldBeConnected = false
			this.reconnectTcp(10)
		}
	}

	// MARK: Config
	// Return config fields for web config
	getConfigFields() {
		return [
			{
			type: 'textinput',
			id: 'host',
			label: 'IP-Adress of Picturall server',
			width: 6,
			default: '192.168.2.140',
			regex: Regex.IP,
			tooltip: 'Enter the IP-adress of the Picturall server you want to control. The IP of the unit can be found on the frontpanel LCD.'
			}
		]
	}

	// MARK: Actions
	updateActions() {

		this.setActionDefinitions({
			'run_cue': {
				name: 'Run Cue',
				options: [{
					type: 'textinput',
					label: 'Cue',
					id: 'cue',
					default: '1',
					regex: '/^0*[1-9][0-9]*$/',
					useVariables: true,
				}],
				callback: async (action) => {
					this.sendcmd('set cue1 playback cue=' + parseInt(await this.parseVariablesInString(action.options.cue)).toString())
				}
			},

			'playback_go': {
				name: 'Playback Go',
				options: [{
					type: 'textinput',
					label: 'Playback to go',
					id: 'playback',
					default: '1',
					regex: '/^0*[1-8]$/',
					useVariables: true,
				}],
				callback: async (action) => {
					this.sendcmd('set stack' + parseInt(await this.parseVariablesInString(action.options.playback)).toString() + ' control command=1')
				}
			},

			'playback_goto': {
				name: 'Playback Goto',
				options: [{
					type: 'textinput',
					label: 'Playback to goto',
					id: 'playback',
					default: '1',
					regex: '/^0*[1-8]$/',
					useVariables: true,
				}, {
					type: 'textinput',
					label: 'Cue to go',
					id: 'cue',
					default: '1.0',
					regex: '/^0*[1-9][0-9]*(\.[0-9]+)?$/',
					useVariables: true,
				}],
				callback: async (action) => {
					const cue = await this.parseVariablesInString(action.options.cue)
					let cmd = 'set stack' +
						parseInt(await this.parseVariablesInString(action.options.playback)).toString() +
						' select major=' + parseInt(cue).toString();
					if (cue.match(/\./)) {
						cmd += ',minor=' + parseInt(cue.match(/\.(\d+)/)[1]).toString();
					}
					this.sendcmd(cmd)
				}
			},

			'playback_selectcuestack': {
				name: 'Select Cuestack into Playback',
				options: [{
					type: 'textinput',
					label: 'Cuestack',
					id: 'cuestack',
					default: '1',
					regex: '/^0*[1-9][0-9]*$/',
					useVariables: true,
				}, {
					type: 'textinput',
					label: 'Playback to select into',
					id: 'playback',
					default: '1',
					regex: '/^0*[1-8]$/',
					useVariables: true,
				}],
				callback: async (action) => {
					this.sendcmd('set stack' +
						parseInt(await this.parseVariablesInString(action.options.playback)).toString() +
						' select cue_stack=' + parseInt(await this.parseVariablesInString(action.options.cuestack)).toString() +
						'major=0 minor=0')
				}
			},

			'playback_release': {
				name: 'Playback Release',
				options: [{
					type: 'textinput',
					label: 'Playback to release',
					id: 'playback',
					default: '1',
					regex: '/^0*[1-8]$/',
					useVariables: true,
				}],
				callback: async (action) => {
					this.sendcmd('set stack' + parseInt(await this.parseVariablesInString(action.options.playback)).toString() + ' select cue_stack=0')
				}
			},

			'layer_playback': {
				name: 'Layer Playback control',
				options: [{
					type: 'textinput',
					label: 'Layer',
					id: 'layer',
					regex: '/^0*[1-9][0-9]*$/',
					useVariables: true,
				}, {
					type: 'dropdown',
					label: 'Play command',
					id: 'playstate',
					default: '0',
					choices: [
						{ id: '0', label: 'Play' },
						{ id: '5', label: 'Pause' },
						{ id: '6', label: 'Stop' },
						{ id: 't', label: 'Toggle Play/Pause' }
					]
				}],
				callback: async (action) => {
					const layer = parseInt(await this.parseVariablesInString(action.options.layer))
					const layerps = this.sourceplaystates[layer]
					let ps = 6;
					if (action.options.playstate === 't') {
						if (layerps === 5 || layerps === 6) ps = 0;
						else ps = 5;
					}
					else ps = parseInt(action.options.playstate);
					this.sendcmd('set source' + layer.toString() + ' control play_state_req=' + ps.toString())
				}
			},

			'layer_playback_seek': {
				name: 'Layer Playback Seek',
				options: [{
					type: 'textinput',
					label: 'Layer',
					id: 'layer',
					regex: '/^0*[1-9][0-9]*$/',
					useVariables: true,
				}, {
					type: 'dropdown',
					label: 'Seek command',
					id: 'seek',
					default: '0',
					choices: [
						{ id: '0', label: 'Goto Inpoint' },
						{ id: '1', label: 'Goto Outpoint' },
						{ id: '5', label: 'Previous Frame' },
						{ id: '6', label: 'Next Frame' }
					]
				}],
				callback: async (action) => {
					const cmdmap = {
						0: ' control seek=0.0',
						1: ' control seek=1.0',
						5: ' tools step=-1',
						6: ' tools step=1'
					}
					this.sendcmd('set source' + parseInt(await this.parseVariablesInString(action.options.layer)).toString() + cmdmap[action.options.seek])
				}
			},

			'layer_playback_endaction': {
				name: 'Set Layer Media End Action',
				options: [{
					type: 'textinput',
					label: 'Layer',
					id: 'layer',
					regex: '/^0*[1-9][0-9]*$/',
					useVariables: true,
				}, {
					type: 'dropdown',
					label: 'End Action',
					id: 'endaction',
					default: '0',
					choices: [
						{ id: '0', label: 'Default' },
						{ id: '4', label: 'Loop' },
						{ id: '10', label: 'Loop Collection' },
						{ id: '11', label: 'Random' },
						{ id: '1', label: 'Play Next' },
						{ id: '3', label: 'Pause' },
						{ id: '2', label: 'Stop' }
					]
				}],
				callback: async (action) => {
					this.sendcmd('set source' + parseInt(await this.parseVariablesInString(action.options.layer)).toString() + ' control media_end_action=' + parseInt(action.options.endaction).toString())
				}
			},

			'sendcustomcommand': {
				name: 'Send custom command',
				options: [{
					type: 'textinput',
					label: 'Command',
					id: 'command',
					default: '',
					tooltip: "Enter any command you like in plain ASCII. Beware of correct syntax, you mustn't enter the linefeed at the end of the command.",
					regex: '/^.+$/i',
					useVariables: true,
				}],
				learn: (action) => {
					const newoptions = {}
					newoptions['command'] = `set ${this.lastcmd.object} ${this.lastcmd.ctrlParam}`
					return newoptions
				},
				callback: async (action) => {
					this.sendcmd(await this.parseVariablesInString(action.options.command))
				}
			}

		})
	}

	// MARK: Feedbacks
	updateFeedbacks() {
		let feedbacks = {};

		feedbacks['playback_empty'] = {
			name: 'Playback has Cuestack',
			description: 'Show if the specified playback has a cuestack (is not empty)',
			type: 'boolean',
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255,0,0)
			},
			options: [
				{
					type: 'textinput',
					label: 'Playback',
					id: 'playback',
					default: '1',
					regex: '/^0*[1-9][0-9]*$/'
				}
			],
			callback: (feedback) => {
				return (this.getCuestack(feedback.options.playback) >= 1)
			}
		};

		feedbacks['source_playstate'] = {
			name: 'Playstate',
			description: 'Change the bank when playstate of the selected source changes',
			type: 'boolean',
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255,0,0)
			},
			options: [
				{
					type: 'textinput',
					label: 'Source',
					id: 'source',
					default: '1',
					regex: '/^0*[1-9][0-9]*$/'
				},{
					type: 'dropdown',
					label: 'Playstate',
					id: 'playstate',
					default: '0',
					choices: [
						{ id: '0', label: 'Play' },
						{ id: '5', label: 'Pause' },
						{ id: '6', label: 'Stop' }
					]
				}
			],
			callback: (feedback) => {
				return (this.sourceplaystates[feedback.options.source] == feedback.options.playstate)
			}
		}

		this.setFeedbackDefinitions(feedbacks);
	}

	// MARK: Variables
	updateVariables() {
		let variables = [
			{
				variableId: 'software_version',
				name: 'Version of the Server Software',
			}
		]

		for (let pb = 1; pb <= this.numPlaybacks; pb++) {
			variables.push(
				{
					variableId: 'playback' + pb + '_cuestack',
					name: 'Cue Stack in Playback ' + pb,
				},{
					variableId: 'playback' + pb + '_cue',
					name: 'Active Cue in Playback ' + pb,
				},{
					variableId: 'playback' + pb + '_state',
					name: 'Transition State of Playback ' + pb,
				},{
					variableId: 'playback' + pb + '_progress',
					name: 'Fade Progress of Playback ' + pb,
				}
			)
		}

		this.setVariableDefinitions(variables);

		let initialData = {
			software_version: 'unknown'
		}

		for (let pb = 1; pb <= this.numPlaybacks; pb++) {
			initialData['playback' +pb+ '_cuestack'] = 'unknown'
			initialData['playback' +pb+ '_cue'] = 'unknown'
			initialData['playback' +pb+ '_state'] = 'unknown'
			initialData['playback' +pb+ '_progress'] = '0%'
		}

		this.setVariableValues(initialData)

	}

	// MARK: Presets
	updatePresets() {
		let presets = {}
		let myname = this.label || 'Picturall'

		for (let pb = 1; pb <= this.numPlaybacks; pb++) {
			presets['go-pb' + pb] = {
				category: 'Playbacks',
				type: 'button',
				name: 'Go button for playback ' + pb,
				style: {
					text: 'GO ' + pb,
					size: 'auto',
					color: 0,
					bgcolor: combineRgb(255, 0, 0)
				},
				steps: [
					{
						down: [
							{
								actionId: 'playback_go',
								options: {
									playback: pb.toString()
								}
							}
						],
						up: [],
					},
				],
				feedbacks: []
			}
			
			presets['play-pb' + pb] = {
				category: 'Playbacks with Cuestatus',
				type: 'button',
				name: 'Go button for playback ' + pb,
				style: {
					text: 'GO ' + pb + '\\n$(' + myname + ':playback' + pb + '_cuestack) : $(' + myname + ':playback' + pb + '_cue)',
					size: 'auto',
					color: 0,
					bgcolor: combineRgb(127, 0, 0)
				},
				steps: [
					{
						down: [
							{
								actionId: 'playback_go',
								options: {
									playback: pb.toString()
								}
							}
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'playback_empty',
						options: {
							playback: pb,
						},
						style: {
							color: combineRgb(0, 0, 0),
							bgcolor: combineRgb(255, 0, 0)
						}
					}
				]
			}
		}

		for (let la = 1; la <= this.numLayers; la++) {
			presets['play-l'+la] = {
				category: 'Sources',
				type: 'button',
				name: 'Play button for source ' + la,
				style: {
					text: '⏵ ' + la + '\\n$(' +myname+ ':source' + la + '_elapsed)',
					size: '18',
					color: 0,
					bgcolor: combineRgb(127, 0, 0)
				},
				steps: [
			{
				down: [
					{
						actionId: 'layer_playback',
						options: {
							layer: la,
							playstate: 0
						}
					}
					],
				up: [],
			},
				],
				feedbacks: [
					{
						feedbackId: 'source_playstate',
						options: {
							source: la,
							playstate: '0',
						},
						style: {
							color: combineRgb(0, 0, 0),
							bgcolor: combineRgb(255, 0, 0)
						}
					}
				]
			}

			presets['pause-l'+la] = {
				category: 'Sources',
				type: 'button',
				name: 'Pause button for source ' + la,
				style: {
					text: '⏸ ' + la,
					size: '18',
					color: 0,
					bgcolor: combineRgb(127, 0, 0)
				},
				steps: [
			{
				down: [
					{
						actionId: 'layer_playback',
						options: {
							layer: la,
							playstate: 5
						}
					}
					],
				up: [],
			},
				],
				feedbacks: [
					{
						feedbackId: 'source_playstate',
						options: {
							source: la,
							playstate: '5',
						},
						style: {
							color: combineRgb(0, 0, 0),
							bgcolor: combineRgb(255, 0, 0)
						}
					}
				]
			}
			
			presets['stop-l'+la] = {
				category: 'Sources',
				type: 'button',
				name: 'Stop button for source ' + la,
				style: {
					text: '⏹ ' + la + '\\n$(' +myname+ ':source' + la + '_countdown)',
					size: '18',
					color: 0,
					bgcolor: combineRgb(127, 0, 0)
				},
				steps: [
			{
				down: [
					{
						actionId: 'layer_playback',
						options: {
							layer: la,
							playstate: 6
						}
					}
					],
				up: [],
			},
				],
				feedbacks: [
					{
						feedbackId: 'source_playstate',
						options: {
							source: la,
							playstate: '6',
						},
						style: {
							color: combineRgb(0, 0, 0),
							bgcolor: combineRgb(255, 0, 0)
						}
					}
				]
			}
		}

		this.setPresetDefinitions(presets)
	}

	setControlState(idx,ctrlstate) {
		this.objects[idx] = ctrlstate
	}

	formatTime(time, divisions = 10) {
		// divisions is how many frames are in one second, 1000=ms, 0=none
		let h,m,s,ret
		time /= 1000000; //make milliseconds out of nanoseconds
		h = Math.floor(time / 3600000)
		m = Math.floor(time%3600000 / 60000)
		s = Math.floor(time%60000 / 1000)
		ret = [h,m,s].join(':')
		if (divisions !=0) {
			ret += '.' + Math.round(time%1000 / divisions)
		}
		return ret
	}	

	connectTcpOld() {
		this.shouldBeConnected = true
		console.log('debug', `trying to connect to ${this.config.host}:11000`)
		this.updateStatus(InstanceStatus.Connecting)
		this.socket.connect({port: 11000, host: this.config.host})
	}

	reconnectTcp(delay) {
		clearTimeout(this.timer)
		this.socket.destroy()
		this.socket.unref()
		const instance = this
		this.timer = setTimeout(() => {
			instance.connectTcp()
		}, delay)
	}

	// MARK: TCP Connection
	connectTcp() {
		let instance = this
		let receivebuffer = ''
		this.socket = new net.Socket()
		this.socket.setTimeout(3000)
		this.socket.setKeepAlive(true)

		if (this.config.host.match(this.RegexIP)) {

			function openingTimeoutHandler() {
				if (instance.socket.readyState === 'opening') {
					instance.log('error', "Network error: ETIMEDOUT during opening, will retry in 2s")
					instance.socket.off('close', closeHandler)
					instance.reconnectTcp(2000)
				}
			}

			this.socket.on('timeout', openingTimeoutHandler)

			this.socket.on('error', (err) => {
				this.log('error', "Network error: " + err.message)
				this.updateStatus(InstanceStatus.ConnectionFailure)
			})

			this.socket.on('connect', () => {
				this.socket.off('timeout', openingTimeoutHandler)
				this.socket.setTimeout(60000)
				this.log('debug',"Connected")
				this.sendcmd("wait_startup")
				this.updateStatus(InstanceStatus.Connecting, 'Connected, waiting for server ready');
				// we don't know if the application is ready to receive commands
			})

			function closeHandler() {
				if (instance.shouldBeConnected) {
					instance.log('error', 'Network connection closed, will retry in 2s')
					instance.updateStatus(InstanceStatus.ConnectionFailure)
					instance.reconnectTcp(2000)
				} else {
					instance.updateStatus(InstanceStatus.Disconnected)
				}
			}

			this.socket.on('close', closeHandler)

			// separate buffered stream into lines with responses
			this.socket.on('data', (chunk) => {
				let i = 0, line = ''
				receivebuffer += chunk
				if (receivebuffer.length > 64000) {
					this.log('warn', 'Receive buffer overflow, flushing')
					receivebuffer = ''
				}
				while ( (i = receivebuffer.indexOf('\n')) !== -1) {
					line = receivebuffer.substring(0, i);
					receivebuffer = receivebuffer.substring(i + 1);
					this.socket.emit('receiveline', line.toString());
				}
			});

			this.socket.on('receiveline', (line) => {
				//use this debug only for debugging!
				//if (line.match(/info timecode=\d+,tz_offset=/) === null && line.match(/\w/)) console.log("Received line from Picturall: "+ line)

				if (line.match(/Show running!$/i)) {
					// now it is ready
					this.updateStatus(InstanceStatus.Ok);
					this.sendcmd("loglevel all"); // switch on human readable messages
					this.sendcmd("config"); // request some server information
					this.sendcmd("receiving all"); // switch on machine readable messages
					this.sendcmd("enum_objects"); // request the list of server objects (layers, stacks...) and their IDs
					for(let i=1; i<9; i++) {
						this.sendcmd('ctrl_status stack'+i); // request the status of the stacks
					}
				}

				if (line.match(/config->version=[\d\.]+/)) {
					this.firmwareVersion = line.match(/config->version=([\d\.]+)/)[1];
					this.log('info', this.label +" software version is "+ this.firmwareVersion);
					this.setVariableValues({ software_version: this.firmwareVersion });
					this.sendcmd("loglevel none"); // switch off human readable messages
				}

				if (line.match(/MSG\(\d+, \d+, 15, (.+)\)/)) {
					//I receive a enum of all objects
					let enums = line.match(/MSG\(\d+, \d+, 15, (.+)\)/)[1]
					let pairs = enums.split(/\\n/)
					pairs.forEach((pair) => {
						let objId = pair.split(':')[0]
						let obNam = pair.split(':')[1]
						if (objId && obNam) {
							this.objects[objId] = { 'objname': obNam }
							if(obNam !== undefined && obNam.match(/^(audio|layer|stack|source)/)) {
								let objType = obNam.match(/([a-zA-Z]+)/)[1]
								let objIndex = parseInt(obNam.match(/(\d+$)/)[1])
								this.objects[objId].type = objType
								this.objects[objId].index = objIndex
								if (this.objIds[objType] === undefined) {
									this.objIds[objType] = []
								}
								this.objIds[objType][objIndex] = parseInt(objId);
							}
						} else {
							this.log('error', `Received malformed object description '${pair}'`)
						}
					})
				}

				if (line.match(/MSG\(\d+, \d+, 13, .+\)/)) {

					// I receive a control status, first let's get the object id sending the message
					let [_all, objId, ctrlParam] = line.match(/MSG\(\d+, (\d+), 13, (.+)\)/)
					const obj = this.objects[objId]
					if (obj) { 
						const objname = obj.objname

						// store for learn button if it is not a time message
						if (objname !== 'wallclock') {
							this.lastcmd.object = objname
							this.lastcmd.ctrlParam = ctrlParam
						}

						// Now let's check if we are interested in the message of this object
						if (obj.type === 'stack') {

							// here we get the selected cuestack and cue
							let matches = line.match(/select cue_stack=(\d+),major=(\d+),minor=(\d+)/);
							if (matches) {
								this.setVariableValues({
									['playback' + obj.index + '_cuestack']: matches[1],
									['playback' + obj.index + '_cue']: matches[2] + '.' + matches[3]
								})
								this.cuestacks[obj.index] = matches[1]
								this.checkFeedbacks('playback_empty')
							}

						}
						if (obj.type === 'source') {

							// here we get the media infos
							let matches = line.match(/info media_file="([^"]*)",play_state=(\d+),timecode=(\d+),media_length=(\d+)\)/);
							if (matches) {
								this.setVariableValues({
									['source' + obj.index + '_elapsed']: this.formatTime(parseInt(matches[3]), 0),
									['source' + obj.index + '_countdown']: this.formatTime(parseInt(matches[4]) - parseInt(matches[3]), 0)
								})
								let ps = parseInt(matches[2])
								if (this.sourceplaystates[obj.index] !== ps) {
									this.sourceplaystates[obj.index] = ps; // 0=Play 5=Pause 6=Stop
									switch(ps) {
										case '0':
											this.setVariableValues({['source' + obj.index + '_playstate']: 'Play'})
											break
										case '5':
											this.setVariableValues({['source' + obj.index + '_playstate']: 'Pause'})
											break
										case '6':
											this.setVariableValues({['source' + obj.index + '_playstate']: 'Stop'})
											break
										default:
											this.setVariableValues({['source' + obj.index + '_playstate']: ''})
											break
									}
									this.checkFeedbacks('source_playstate')
								}
							}
						}
					} else {
						this.log('error', `Received #13 control status ${ctrlParam} for id ${objId}, but can't find this object.`)
					}
				}

				if (line.match(/MSG\(\d+, \d+, 32, .+\)/)) {

					// I receive a mysterious #32 message
					let objId = line.match(/MSG\(\d+, (\d+), 32, .+\)/)[1]

					const obj = this.objects[objId]
						if (obj) {

						// Now let's check if we are interested in the message of this object, atm we are only looking for stacks
						if (obj.type === 'stack') {

							// here we get some info about the playback state
							let matches = line.match(/state="(.*?)", progress=(\d+\.\d+), timing=(\d+\.\d+)\/(\d+\.\d+)\/(\d+\.\d+)/)
							if (matches) {
								this.setVariableValues({['playback' + obj.index + '_state']: matches[1]})
								if (parseFloat(matches[4]) !== 0 ) {
									this.setVariableValues({
										['playback' + obj.index + '_progress']: Math.round(100.0 * Math.min(parseFloat(matches[2]) / parseFloat(matches[4]), 1)).toString() + '%'
									})
								}
								else {
									this.setVariableValues({['playback' + obj.index + '_progress']: parseFloat(matches[2]) + '%'})
								}
							}
						}
					} else {
						this.log('error', `Received #32 control status ${ctrlParam} for id ${objId}, but can't find this object.`)
					}
				}

				if (line.match(/MSG\(\d+, \d+, 31, source="stack\d+\.select\.cue_stack".+\)/)) {

					// I receive a mysterious #31 message, seems somebody has changed the cuestack
					const stack = parseInt(line.match(/MSG\(\d+, \d+, 31, source="stack(\d+)\.select\.cue_stack".+\)/)[1])

					if (stack > 0) {
						this.sendcmd('ctrl_status stack'+stack); // better to request a status then trying to map cuestack IDs
					}
				}

				if (line.match(/Unknown command: ".+?"/)) {
					this.log('error',"Received error from "+ this.label +" - Unknown command: "+ line.match(/Unknown command: "(.+?)"/)[1]);
				}

			});

			this.shouldBeConnected = true
			console.log('debug', `trying to connect to ${this.config.host}:11000`)
			this.updateStatus(InstanceStatus.Connecting)
			this.socket.connect({port: 11000, host: this.config.host})

		}
	}

	sendcmd(cmd) {
		if (cmd !== undefined) {
			cmd +="\n";

			if (this.socket === undefined) {
				this.init_tcp();
			}

			// TODO: remove this when issue #71 is fixed
			if (this.socket !== undefined && this.socket.remoteAddress != this.config.host) {
				this.init_tcp()
			}

			this.log('debug','sending tcp ' + cmd + " to " +this.config.host)

			if (this.socket !== undefined && this.socket.readyState === 'open' ) {
				this.socket.write(cmd)
			} else {
				this.log('debug','Socket not connected')
			}

		}
	}

	getCuestack(pb) {
		return this.cuestacks[pb]
	}

}

// MARK: Upgrade Script
const upgradeToBooleanFeedbacks = CreateConvertToBooleanFeedbackUpgradeScript({
	source_playstate: {
		goodfg: 'color',
		goodbg: 'bgcolor'
	},
	playback_empty: {
		goodfg: 'color',
		goodbg: 'bgcolor'
	}

})

runEntrypoint(Picturall, [upgradeToBooleanFeedbacks])
