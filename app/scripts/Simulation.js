'use strict';

var Tank = require("./Tank.js");
var Bullet = require("./Bullet.js");
var Battlefield = require("./Battlefield.js");
var CollisionResolver = require("./CollisionResolver.js");
var AiWrapper = require("./AiWrapper.js");
var seedrandom = require("seedrandom");


module.exports = class Simulation {

  constructor(renderer) {
    this._aiList = [];
    this._allTankList = [];
    this._tankList = [];
    this._bulletList = [];
    this._explodedTankList = [];
    this._explodedBulletList = [];
    this._battlefield = new Battlefield();
    this._simulationTimeout = null;
    this._renderInterval = null;
    this._simulationStepDuration = 17;
    this._renderStepDuration = 30;
    this._renderer = renderer;
    this._isRunning = false;
    this._collisionResolver = new CollisionResolver();
    this._rngSeed = (new Date()).getTime();
    this._rng = seedrandom(this._rngSeed);
    this._speedMultiplier = 1;
    this._onSimulationStepCallback = [];
    this._onRenderStepCallback = [];
    this._onFinishCallback = [];
    this._onErrorCallback = [];
    this._timeElapsed = 0;
    this._timeLimit = 30000;
    Math.random = this._rng;
  }

  init(width, height) {
    this._battlefield.setSize(width, height);
    this._renderer.initBatlefield(this._battlefield);
    this._collisionResolver.updateBattlefield(this._battlefield);
  }

  get tankList() {
    return this._allTankList;
  }

  onStep(callback) {
    this._onSimulationStepCallback.push(callback);
  }

  onRender(callback) {
    this._onRenderStepCallback.push(callback);
  }

  onFinish(callback) {
    this._onFinishCallback.push(callback);
  }

  onError(callback) {
    this._onErrorCallback.push(callback);
  }

  get renderer() {
    return this._renderer;
  }

  get battlefield() {
    return this._battlefield;
  }

  get timeElapsed() {
    return this._timeElapsed;
  }

  get timeLimit() {
    return this._timeLimit;
  }

  set timeLimit(v) {
    this._timeLimit = v;
  }


  setSpeed(v) {
    this._speedMultiplier = Math.max(0.1, Number(v));
  }

  start() {
    this._isRunning = true;
    var i;
    var self = this;

    if(this._renderInterval) {
      clearInterval(this._renderInterval);
      this._renderInterval = null;
    }

    this._renderInterval = setInterval(function (){
      self._updateView();
    }, this._renderStepDuration);

    this._activateAi()
      .then(function(result) {
        if(self._simulationTimeout) {
          clearTimeout(self._simulationTimeout);
        }
        self._simulationStep();
      })
      .catch(function(err) {
        console.error(err.message);
        console.error(err);
        for(i=0; i < self._onErrorCallback.length; i++) self._onErrorCallback[i](err.message ? err.message : "Error during simulation");
      });
  }

  _simulationStep() {
    var startTime = (new Date()).getTime();
    var self = this;
    var i;
    this._updateModel();
    this._updateAi()
      .then(function(result) {
        if(self._getTanksLeft() <= 1 || self._timeElapsed == self._timeLimit) {
          self.stop();
          self._updateView();
          for(i=0; i < self._onFinishCallback.length; i++) self._onFinishCallback[i]();
        }
        if(self._isRunning) {
          var processingTime = (new Date()).getTime() - startTime;
          var dt = self._simulationStepDuration - processingTime;
          dt = Math.max(1, dt);
          dt /= self._speedMultiplier;

          for(i=0; i < self._onSimulationStepCallback.length; i++) self._onSimulationStepCallback[i]();
          self._timeElapsed = Math.min(self._timeElapsed + self._simulationStepDuration, self._timeLimit);
          self._simulationTimeout = setTimeout(self._simulationStep.bind(self), dt);
        }

      })
      .catch(function(err) {
        console.error(err.message);
        console.error(err);
        for(i=0; i < self._onErrorCallback.length; i++) self._onErrorCallback[i](err.message ? err.message : "Error during simulation");
      });
  }

  stop() {
    this._isRunning = false;
    if(this._simulationTimeout) {
      clearTimeout(this._simulationTimeout);
      this._simulationTimeout = null;
    }
    if(this._renderInterval) {
      clearInterval(this._renderInterval);
      this._renderInterval = null;
    }
    var tank, ai, i;
    for(i=0; i < this._aiList.length; i++) {
      ai = this._aiList[i];
      if(!ai) continue;
      ai.deactivate();
    }

  }

  addTank(aiName) {
    if(!this._battlefield) {
      throw "Simulation not initialized";
    }
    var startSlot = this._battlefield.getStartSlot();
    if(!startSlot) {
      throw "No free space in the battlefield";
    }
    var tank = this._createTank(aiName);
    tank.randomize();
    tank.moveTo(startSlot.x, startSlot.y);
    this._tankList.push(tank);
    this._allTankList.push(tank);

    var ai = this._createAiWrapper(tank);
    this._aiList.push(ai);

    this._updateView();
    return ai;
  }

  _activateAi() {
    var self = this;
    return new Promise(function (resolve, reject) {
      var promise = new Promise(function(done, err) { done(); });

      promise = self._aiList.reduce(function (chain, ai) {
        if(!ai) {
          return chain;
        } else {
          return chain.then(ai.activate.bind(ai, self._rngSeed));
        }
      }, promise);
      promise
        .then(function() {
          resolve();
        })
        .catch(function(err) {
          reject(err);
        });
    });
  }

  _updateAi() {
    var self = this;
    return new Promise(function (resolve, reject) {

      var promise = new Promise(function(done, err) { done(); });

      promise = self._aiList.reduce(function (chain, ai) {
      	if(!ai) {
        	return chain;
        } else {
        	return chain.then(ai.simulationStep.bind(ai));
        }
      }, promise);
      promise
        .then(function() {
          resolve();
        })
        .catch(function(err) {
          reject(err);
        });
    });
  }

  _updateModel() {
    let i, tank, bullet, ai;

    for(i=0; i < this._tankList.length; i++) {
      tank = this._tankList[i];
      if(!tank) continue;
      tank.simulationStep(this._collisionResolver);
    }

    var killCount = 0;
    for(i=0; i < this._tankList.length; i++) {
      tank = this._tankList[i];
      if(!tank) continue;
      if(tank.energy <= 0) {
        killCount++;
        this._tankList[i] = null;
        this._explodedTankList.push(tank);
        this._collisionResolver.removeTank(tank);
      }
    }
    for(i=0; i < this._aiList.length; i++) {
      ai = this._aiList[i];
      if(!ai) continue;
      if(ai.tank.energy <= 0) {
        this._aiList[i] = null;
        ai.deactivate();
      }
    }

    for(i=0; i < this._tankList.length; i++) {
      tank = this._tankList[i];
      if(!tank) continue;
      if(tank.isShooting) {
        var power = tank.handleShoot();
        bullet = this._createBullet(tank, power);
        this._bulletList.push(bullet);
      }
    }
    for(i=0; i < this._tankList.length; i++) {
      tank = this._tankList[i];
      if(!tank) continue;
      for(var j=0; j < killCount; j++) {
        tank.onSurviveScore();
      }
    }
    let hitTest;
    for(i=0; i < this._bulletList.length; i++) {
      bullet = this._bulletList[i];
      if(!bullet) continue;
      bullet.simulationStep();
      hitTest = this._collisionResolver.hitTestBullet(bullet);
      if(hitTest) {
        this._bulletList[i] = null;
        this._explodedBulletList.push(bullet);
        this._collisionResolver.removeBullet(bullet);
      }
    }
  }

  _updateView() {
    let i, tank, bullet;
    this._renderer.preRender();
    this._renderer.renderClock(this._timeElapsed, this._timeLimit);
    for(i=0; i < this._tankList.length; i++) {
      tank = this._tankList[i];
      if(!tank) continue;
      this._renderer.renderTank(tank);
    }
    for(i=0; i < this._bulletList.length; i++) {
      bullet = this._bulletList[i];
      if(!bullet) continue;
      this._renderer.renderBullet(bullet);
    }
    while(this._explodedTankList.length) {
      tank = this._explodedTankList.pop();
      this._renderer.renderTank(tank);
    }
    while(this._explodedBulletList.length) {
      bullet = this._explodedBulletList.pop();
      this._renderer.renderBullet(bullet);
    }
    this._renderer.renderTankStats(this._allTankList);
    this._renderer.postRender();
    for(i=0; i < this._onRenderStepCallback.length; i++) this._onRenderStepCallback[i]();
  }

  _getTanksLeft() {
    var tanksLeft = 0;
    var tank;
    for(var i=0; i < this._tankList.length; i++) {
      tank = this._tankList[i];
      if(!tank) continue;
      tanksLeft++;
    }
    return tanksLeft;
  }

  _createAiWrapper(tank) {
    return new AiWrapper(tank);
  }

  _createTank(aiName) {
    return new Tank(aiName);
  }

  _createBullet(owner, power) {
    return new Bullet(owner, power);
  }

};