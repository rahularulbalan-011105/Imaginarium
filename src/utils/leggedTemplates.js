// Code templates for legged robots (CODE → C++ Coding → Templates).
//
// They steer the body with walk()/turn()/stopWalking(); the built-in gait
// engine moves the legs. Sign convention = the sim D-pad:
//   walk(+) forward · walk(−) backward · turn(+) left · turn(−) right,
//   and when walking BACKWARD the turn is flipped (like reversing a car), so
//   "backward left" swings the robot's rear to its left — same as ▼ + ◄.

// The eight moves, as helper functions every full-movement template shares.
const MOVES = `const int SPEED     = 70;    // walking speed, % (1..100)
const int TURN      = 60;    // turning rate, %  (1..100)
const int MOVE_TIME = 2000;  // ms per move
const int PAUSE     = 800;   // ms standing still between moves

void forward()       { walk(SPEED);  turn(0);     }
void backward()      { walk(-SPEED); turn(0);     }
void turnLeft()      { walk(0);      turn(TURN);  }   // turn on the spot
void turnRight()     { walk(0);      turn(-TURN); }
void forwardLeft()   { walk(SPEED);  turn(TURN);  }   // curve while walking
void forwardRight()  { walk(SPEED);  turn(-TURN); }
void backwardLeft()  { walk(-SPEED); turn(-TURN); }   // reversing: rear swings left
void backwardRight() { walk(-SPEED); turn(TURN);  }

void pause() {
  stopWalking();
  delay(PAUSE);
}

void setup() {
  Serial.begin(9600);
  stopWalking();
  delay(1000);                 // stand still for a moment
}

void loop() {
  Serial.println("Forward");         forward();       delay(MOVE_TIME); pause();
  Serial.println("Backward");        backward();      delay(MOVE_TIME); pause();
  Serial.println("Left");            turnLeft();      delay(MOVE_TIME); pause();
  Serial.println("Right");           turnRight();     delay(MOVE_TIME); pause();
  Serial.println("Forward + left");  forwardLeft();   delay(MOVE_TIME); pause();
  Serial.println("Forward + right"); forwardRight();  delay(MOVE_TIME); pause();
  Serial.println("Backward + left"); backwardLeft();  delay(MOVE_TIME); pause();
  Serial.println("Backward + right");backwardRight(); delay(MOVE_TIME); pause();
}`

export const LEGGED_TEMPLATES = [
  {
    label: '2 legs: forward / back',
    code: `// 2-LEGGED ROBOT — forward and backward only.
// For a biped whose hip/knee servos all swing front-to-back (e.g. the micro
// duck): it physically cannot turn, so this sketch never asks it to.
// walk(speed): -100..100 (%). The built-in gait moves the legs — don't also
// Servo.write() the leg servos in this sketch.
// Tip: if "Forward" walks it backward, set SIMULATE → Physics → Robot →
// Forward axis to the way the robot faces.

const int SPEED     = 70;    // walking speed, % (1..100)
const int MOVE_TIME = 3000;  // ms per direction
const int PAUSE     = 1000;  // ms standing still between moves

void setup() {
  Serial.begin(9600);
  stopWalking();
  delay(PAUSE);
}

void loop() {
  Serial.println("Forward");
  walk(SPEED);
  delay(MOVE_TIME);

  stopWalking();
  delay(PAUSE);

  Serial.println("Backward");
  walk(-SPEED);
  delay(MOVE_TIME);

  stopWalking();
  delay(PAUSE);
}`,
  },
  {
    label: '2 legs: full movement',
    code: `// 2-LEGGED ROBOT — full movement: forward, backward, left, right and the
// four diagonals (forward/backward + left/right).
// Turning needs a TWIST servo (vertical hinge) at the hips. A biped without
// one can't turn: the sim ignores turn() and says so on the Serial monitor —
// use the "2 legs: forward / back" template for that robot instead.
// walk(+) forward · walk(-) backward · turn(+) left · turn(-) right (-100..100 %).
// Tip: if "Forward" walks it backward, set SIMULATE → Physics → Robot →
// Forward axis to the way the robot faces.

${MOVES}`,
  },
  {
    label: '4 legs: full movement',
    code: `// 4-LEGGED ROBOT — full movement: forward, backward, left, right and the
// four diagonals (forward/backward + left/right).
// A quadruped turns tank-style (one side strides longer), so it needs no
// twist servo. The built-in trot gait moves the legs — don't also
// Servo.write() the leg servos in this sketch.
// walk(+) forward · walk(-) backward · turn(+) left · turn(-) right (-100..100 %).
// Tip: if "Forward" walks it backward, set SIMULATE → Physics → Robot →
// Forward axis to the way the robot faces.

${MOVES}`,
  },
]
