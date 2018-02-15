const express = require("express");
const bodyParser = require("body-parser");
const Redis = require("ioredis");
const router = express.Router();
const redis = new Redis(6379, "127.0.0.1");
redis.set("foo", "bar");

const randomLetter = () =>
	  String.fromCharCode(Math.round(Math.random() * 255));
const randomString = () => {
    let result = "";
    while (0.7 > Math.random()) {
	result += randomLetter();
    }
    return result;
};
const myString = "In information theory, Linguistics and computer science, the Levenshtein distance is a string metric for measuring the difference between two sequences.";

/**
 * Utils.
 */
const Arrays = {};

Arrays.map = xs => f => xs.map(f);

Arrays.flatMap = xs => f =>
    xs.reduce((ys, x) => ys.concat(f(x)), []);

Arrays.concat = xs => ys => xs.concat(ys);

Arrays.sort = xs => comparator => {
    xs.sort(comparator);
    return xs;
};

const flip = f => x => y => f(y)(x);

const identity = x => x;

const compose = (...fs) =>
	  fs.reduce((f, g) => x => f(g(x)), identity);

const apply = f => x => f(x);

/**
 * Handles the evolution logic.
 */
const Populator = {};

Populator.mutationChance = 0.15;

Populator.birthRate = generation => 10;

Populator.deathRate = generation => 9;

Populator.fitness = x => {
    let correct = 0;
    let size = x.length < myString.length
	    ? x.length
	    : myString.length;
    for (let i = 0; i < size; i++) {
	if (x.charAt(i) == myString.charAt(i)) {
	    correct++;
	}
    }
    return correct;
};

Populator.mutate = x => {
    if (Populator.mutationChance > Math.random()) {
	let mutated = "";
	for (let i = 0; i < x.length; i++) {
	    mutated += (0.05 > Math.random()
			? ""
			: (0.10 > Math.random()
			   ? randomLetter()
			   : x[i]));
	}
	while (0.05 > Math.random()) {
	    mutated += randomLetter();
	}
	return mutated;
    } else {
	return x;
    }
};

Populator.logisticFunction = k => x0 => x =>
    1 / (1 + Math.pow(Math.E, -k * (x - x0)));

Populator.hyperbolicFunction = Math.tanh;

Populator.selectRandoms = (distribution, number) => {
    const randoms = [];
    for (let i = 0; i < number; i++) {
	randoms.push(distribution(Math.random()));
    }
    return randoms;
};

/*Populator.distribution = xs => x =>
    Math.round((1 - Populator.logisticFunction(10)(0.5)(x)) *
	       (xs.length - 1));*/

Populator.distribution = xs => x =>
    Math.round((1 - Populator.hyperbolicFunction(x * 5)) *
	       (xs.length - 1));

Populator.reproduce = generation => xs => {
    const offspring = Arrays.flatMap(
	Populator.selectRandoms(
	    Populator.distribution(xs),
	    Populator.birthRate(generation)))
	    (Populator.computeParents(xs))
	.map(Populator.crossover);
    return xs.concat(offspring);
};

Populator.computeParents = xs => i =>
    Populator.selectRandoms(Populator.distribution(xs), 2)
    .map(j => [xs[i], xs[j]]);

Populator.crossover = xs => {
    let child = "";
    if (xs[0].length < xs[1].length) {
	for (let i = 0; i < xs[0].length; i++) {
	    child += 0.50 > Math.random()
		? xs[0].charAt(i)
		: xs[1].charAt(i);
	}
	for (let i = xs[0].length; i < xs[1].length; i++) {
	    child += xs[1].charAt(i);
	}
    } else {
	for (let i = 0; i < xs[1].length; i++) {
	    child += 0.50 > Math.random()
		? xs[1].charAt(i)
		: xs[0].charAt(i);
	}
	for (let i = xs[1].length; i < xs[0].length; i++) {
	    child += xs[0].charAt(i);
	}
    }
    return child;
};

Populator.kill = generation => xs => {
    const killed = Populator.selectRandoms(
	Populator.distribution(xs),
	Populator.deathRate(generation));
    const survivers = [];
    for (let i = 0; i < xs.length; i++) {
	if (killed.indexOf(i) > -1) {
	    survivers.push(xs[i]);
	}
    }
    return survivers;
};

Populator.wrapCache = x => ({
    fitness: Populator.fitness(x),
    value: x
});

Populator.unwrapCache = x => x.value;

/**
 * Advances the population one generation.
 */
const nextGeneration = populator => generation => compose(
    populator.reproduce(generation),
    populator.kill(generation),
    flip(Arrays.map)(populator.unwrapCache),
    flip(Arrays.sort)((a, b) => b.fitness - a.fitness),
    flip(Arrays.map)(populator.wrapCache),
    flip(Arrays.map)(populator.mutate)
);

/**
 * Advances the population many generations.
 */
const nextGenerations = populator => generations => population => {
    while (generations > 0) {
	population = nextGeneration(populator)(generations)(population);
	generations--;
    }
    return population;
};

/**
 * Evolves the population and updates the database.
 */
const evolve = (populator, put) => generations =>
	  compose(
	      Promise.all,
	      flip(Arrays.map)(put),
	      nextGenerations(populator)(generations)
	  );

const log = x => {
    console.log(x);
    return x;
};

/**
 * Pops an element from the redis DB.
 */
const popElements = elements =>
	  Promise.all(Array(elements).map($ => redis.lpop("mustrings")))
	  .then(xs => Promise.resolve(
	      xs.map(x => x ? x : randomString())));

/**
 * Pushes an element to the redis DB.
 */
const pushElement = element =>
	  redis.rpush("mustrings", element)
	  .then(x => Promise.resolve(element))
	  .then(x => Promise.resolve(log(x)));

/**
 * Routes.
 */
router.route("/mu/evolve")
    .post(function (req, res) {
	const { elements = 10, generations = 1} = req.body;
	popElements(elements)
	    .then(evolve(Populator, pushElement)(generations))
	    .then(xs => Promise.resolve(log(xs)))
	    .then(xs => res.send(JSON.stringify(xs)))
	    .catch(error => res.status(500).send(error));
    });

router.route("/mu/restart")
    .post(function (req, res) {
	redis.del("mustrings")
	    .then(result => res.send())
	    .catch(error => res.status(500).send(error));
    });


/**
 * Creates the app.
 */
const app = express();

/**
 * Enables post parameters parsing.
 */
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

/**
 * Sets the routes.
 */
app.use("/", router);

/**
 * Starts the app.
 */
app.listen(3000, () => console.log('Example app listening on port 3000!'));


/*router.route('/')
 .get(function (req, res) {
 res.send("Get: " + JSON.stringify(req.params));
 })
 .post(function (req, res) {
 res.send("Post: " + req.body.name);
 });*/
