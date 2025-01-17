export module JCEngineCore {

    export class JCEngine {
        public static entityUrls: Map<JCEntity, string> = new Map();
    
        public static boot(url: string, entity: JCEntity) {
            this.entityUrls.set(entity, url);
            new WebSocketServer(url, entity);
        }
    
        public static reboot(entity: JCEntity) {
            new WebSocketServer(this.entityUrls.get(entity), entity);
        }
    }

    export class JCEntity {
        public id: number;
        public channel: Channel;
        public isValid: boolean;
        public loaded: boolean;
        public components: Map<string, any> = new Map();
    
        public onLoad() {}
    
        public onReload() {}
    
        public onDestroy() {}
    
        public onMiss() {}
    
        public call(func: string, args?: any[], callback?: Function): boolean {
            if (this.isValid) {
                let uuid = "";
                let type = DataType.FUNCTION;
                if (func.indexOf(".") > -1) {
                    type = DataType.METHOD;
                    uuid = CallbackHandler.addCallback(callback);
                }
                if (args == undefined) {
                    args = [];
                }
                let data = {uuid: uuid, type: type, func: func, args: args};
                this.channel.writeAndFlush(JSON.stringify(data));
                return true;
            }
            return false;
        }
    }

    class Channel {
        private webSocket: WebSocket;

        constructor(webSocket: WebSocket) {
            this.webSocket = webSocket;
        }

        public writeAndFlush(text: string) {
            this.webSocket.send(text);
        }

        public close() {
            this.webSocket.close();
        }
    }
    
    class WebSocketServer {
        private webSocket: WebSocket;
        private tempEntity: JCEntity;
        private heartBeatTimerID: number | undefined;
    
        constructor(url: string, entity: JCEntity) {
            this.webSocket = new WebSocket(url);
            this.tempEntity = entity;
    
            this.webSocket.onopen = () => {
                this.call("loadTempEntity");
            }
    
            this.webSocket.onclose = () => {
                this.destroyTempEntity();
            }
    
            this.webSocket.onmessage = (event: MessageEvent) => {
                this.invoke(JSON.parse(event.data));            
            }
        }
    
        private call(func: string, args?: any[]) {
            if (args == undefined) {
                args = [];
            }
            let data: Data = {uuid: "", type: DataType.EVENT, func: func, args: args};
            this.webSocket.send(JSON.stringify(data));
        }
    
        private invoke(data: Data) {
            if (data.type == DataType.EVENT) {
                this[data.func].apply(this, data.args);
                return;
            }
            if (data.type == DataType.FUNCTION) {
                if (this.tempEntity.isValid) {
                    let func = data.func;
                    let context: JCEngine | null = this.tempEntity;
                    let pointIndex = func.lastIndexOf(".");
                    if (pointIndex > -1) {
                        context = null;
                        let key = func.substring(0, pointIndex);
                        let matchContext = this.tempEntity.components.get(key);
                        if (matchContext) {
                            func = func.substring(pointIndex + 1);
                            context = matchContext;
                        }
                    }
                    if (context) context[func].apply(context, data.args);
                }
                return;
            }
            if (data.type == DataType.METHOD) {
                CallbackHandler.handleCallback(data);
            }
        }
    
        public loadTempEntity(id: number) {
            this.tempEntity.id = id;
            this.tempEntity.channel = new Channel(this.webSocket);
            this.tempEntity.isValid = true;
            try {
                this.tempEntity.loaded ? this.tempEntity.onReload() : this.tempEntity.onLoad();
            } catch (e) {}
            this.tempEntity.loaded = true;
            if (this.heartBeatTimerID === undefined) {
                this.heartBeatTimerID = setInterval(() => {
                    this.call("doHeartBeat");
                }, 5 * 1000);
            }
        }
    
        public destroyTempEntity() {
            if (this.heartBeatTimerID !== undefined) {
                clearInterval(this.heartBeatTimerID);
                this.heartBeatTimerID = undefined;
            }
            if (this.tempEntity.isValid) {
                this.tempEntity.isValid = false;
                this.tempEntity.onDestroy();            
            } else {
                this.tempEntity.onMiss();
            }
        }
    }

    class CallbackHandler {
        private static nextID: number = 0;
        private static mapper: Map<string, CallbackInfo> = new Map();
    
        private static uuid(): string {
            this.nextID++;
            return this.nextID.toString();
        }
    
        public static addCallback(callback?: Function): string {
            let uuid = this.uuid();
            if (callback instanceof Function) {
                this.mapper.set(uuid, {
                    callback: callback, 
                    deadTime: Date.now() + 10 * 1000
                });            
            }
            return uuid;
        }
    
        public static handleCallback(data: Data) {
            if (this.mapper.size > 10) {
                let now = Date.now();
                for (let item of Array.from(this.mapper)) {
                    let key = item[0];
                    let value = item[1];
                    if (now >= value.deadTime) {
                        this.mapper.delete(key);
                    }
                }
            }
            let callbackInfo = this.mapper.get(data.uuid);
            if (callbackInfo && callbackInfo.callback instanceof Function) {
                this.mapper.delete(data.uuid);
                callbackInfo.callback(...data.args);
            }
        }
    } 

    interface CallbackInfo {
        callback: Function;
        deadTime: number;
    }

    interface Data {
        uuid: string;
        type: number;
        func: string;
        args: any[];
    }

    enum DataType {
        EVENT,
        FUNCTION,
        METHOD
    }
}
