/**
 * IKPdbService
 * 
 * Copyright (c) 2016 Cyril MORISSE - @cmorisse
 * 
 * The MIT License (MIT)
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */
define(function(require, exports, module) {
    
    "use strict";

    var MessageReader = require("./MessageReader");
    
    //var MessageReader = require("./MessageReader");
    //var DevToolsMessage = require("./DevToolsMessage");
    //var byteLength = Util.byteLength;
    
    var IKPdbService = module.exports = function(socket, breakHandler) {
        this.MAGIC_CODE = "LLADpcdtbdpac";
        this._socket = socket;
        this._breakHandler = breakHandler; // To call when halted on breakpoint, exception
        this._attached = false;
        this._pending = [];
        this._connected = false;
        this._commandId = 0
        this._commandsQueue = {};     // queue of commands to debugger
        this._callbacks = []
    };
    

    (function() {
        /**
         * attach to debugger
         */
        this.attach = function(callback) {
            console.log("IKPdbService attach");
            if (this._connected)
                throw new Error("Already attached!");

            var self = this;
            this._reader = new MessageReader(this._socket, function() {
                self._reader.destroy();
                self._reader = new MessageReader(self._socket, self._receiveMessage.bind(self));
                callback();
            });

            this._socket.on("connect", function(){
                console.log("Socket connection succeeded!");
                this._connected = true; 
            });
            
            this._socket.on("end", function(){
                console.log("Socket connection ended!");
                // TODO: cleanup but what
            });


            this._socket.connect();
        };

        this.detach = function(callback) {
            //if (this._connected)
            //    this.sendCommand("detach");
    
            if (this._socket)
                this._socket.close();
            this._socket = null;
    
            this._connected = false;
            this._commands = {};
            this._callbacks = [];
            this._breakHandler = function() {};
            callback && callback();
        };


        this._jsonSend = function(args) {
            args = JSON.stringify(args);
            var msg = ["length=", args.length, this.MAGIC_CODE, args].join("");
            this._socket.send(msg);
        };

        /*
         * Issue a command to debugger via proxy. Messages append a sequence
         * number to run pending callbacks when proxy replies to that id.
         */
        this.sendCommand = function(command, args, callback) {
            // build message
            var obj = {};
            if (typeof args === "undefined") {
                args = {};
            }
            obj.command = command;
            obj._id = ++this._commandId; // keep track of callback
            obj.args = args;

            if (typeof callback !== "undefined") {
                this._callbacks[this._commandId] = callback;
            }
    
            // send message
            this._commandsQueue[this._commandId] = obj;
            this._jsonSend(obj);
        };

        /*
         * Process incoming messages from the proxy
         */
        this._receiveMessage = function(message) {
            console.log("_receiveMessage(message) <= message=",message);
            var responseParts = message.split(this.MAGIC_CODE);
    
            try {
                var content = JSON.parse(responseParts[1]);
            } 
            catch (ex) {
                console.error("Debugger can't parse JSON from IKPdb proxy", responseParts[1]);
                return;
            }
    
            if (content === null || typeof content !== "object")
                return;
    
            if (content.command == "programEnd") {
                return this._breakHandler(content);
            }
    
            // we've received a frame stack from GDB on break, segfault, pause
            if (content.command == "programBreak")
                return this._breakHandler(content);
    
            // run pending callback if sequence number matches one we sent
            if (typeof content._id == "undefined")
                return;
    
            // execute callback
            var callback = null;
            if (typeof this._callbacks[content._id] === "function")
                callback = this._callbacks[content._id];
    
            // generate an error if the command did not complete successfully
            var err = null;
            if (!content.hasOwnProperty("commandExecStatus") || content.commandExecStatus == "error") {
                var str = "Command " + this._commandsQueue[content._id] + " failed";
                if (content.hasOwnProperty("messages"))
                    str += content.messages.join(" ");
                err = new Error(str);
            }
    
            // remove buffers
            delete this._callbacks[content._id];
            delete this._commandsQueue[content._id];
    
            // run callback
            callback && callback(err, content);
        };


    
    }).call(IKPdbService.prototype);

});