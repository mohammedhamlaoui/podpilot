import { useState } from "react";
import { ArrowUpRight, Play, Video, Check, ListChecks } from "lucide-react";
import Icon from "./Icon";
import "./TutorialsPage.css";

const LESSONS = [
  { platform: "teepublic", name: "TeePublic", id: "c0y8fOPWE78", title: "Your TeePublic upload workflow",
    description: "Follow the PodPilot walkthrough for preparing and uploading your TeePublic designs.",
    topics: ["Prepare your designs", "Configure colors and products", "Start your upload queue"] },
  { platform: "redbubble", name: "Redbubble", id: "C3SB9Zeg7-Y", title: "Your Redbubble upload workflow",
    description: "See how PodPilot brings AI listing tools and Redbubble upload automation into your workflow.",
    topics: ["Organize your designs", "Prepare listing information", "Upload with the extension"] },
];

export default function TutorialsPage() {
  const [selected, setSelected] = useState("teepublic");
  const [playing, setPlaying] = useState(false);
  const lesson = LESSONS.find(item => item.platform === selected);
  return <section className="pp-tutorials" aria-labelledby="tutorials-title">
    <header className="pp-tutorials-header">
      <div>
        <span className="pp-tutorials-eyebrow"><Video size={16} aria-hidden="true" /> PODPILOT GUIDES</span>
        <h1 id="tutorials-title">Watch. Learn. Start uploading.</h1>
        <p>Two guided walkthroughs to help you get comfortable with your workflow.</p>
      </div>
      <a className="secondary-button" href="https://www.youtube.com/@PodPilotSpace" target="_blank" rel="noopener noreferrer">
        PodPilot on YouTube <ArrowUpRight size={16} aria-hidden="true" />
      </a>
    </header>
    <div className="pp-tutorials-choices" role="group" aria-label="Choose a tutorial">
      {LESSONS.map((item, index) => <button key={item.platform} type="button" data-platform={item.platform}
        className={`pp-tutorials-choice${selected === item.platform ? " is-selected" : ""}`}
        aria-pressed={selected === item.platform} onClick={() => { setSelected(item.platform); setPlaying(false); }}>
        <span className="pp-tutorials-number">0{index + 1}</span>
        <Icon name={item.platform} />
        <span><strong>{item.name}</strong><small>Upload walkthrough</small></span>
        <span className="pp-tutorials-choice-mark" aria-hidden="true">{selected === item.platform ? <Check size={18} /> : <Play size={16} />}</span>
      </button>)}
    </div>
    <article className="pp-tutorials-lesson" data-platform={lesson.platform}>
      <div className="pp-tutorials-stage">
        {playing ? <iframe key={lesson.id} src={`https://www.youtube-nocookie.com/embed/${lesson.id}?autoplay=1&rel=0`}
          title={`${lesson.name} upload tutorial — PodPilot`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          : <button type="button" className="pp-tutorials-poster" onClick={() => setPlaying(true)} aria-label={`Play ${lesson.name} tutorial`}>
            <img src={`https://i.ytimg.com/vi/${lesson.id}/hqdefault.jpg`} alt="" />
            <span className="pp-tutorials-play"><Play size={28} fill="currentColor" aria-hidden="true" /></span>
            <span className="pp-tutorials-poster-label">Watch the {lesson.name} guide</span>
          </button>}
      </div>
      <div className="pp-tutorials-description">
        <div><span className="pp-tutorials-platform"><Icon name={lesson.platform} /> {lesson.name} · Video guide</span>
          <h2>{lesson.title}</h2><p>{lesson.description}</p>
        </div>
        <a href={`https://www.youtube.com/watch?v=${lesson.id}`} target="_blank" rel="noopener noreferrer" className="secondary-button">Watch on YouTube <ArrowUpRight size={16} aria-hidden="true" /></a>
      </div>
      <div className="pp-tutorials-topics"><span><ListChecks size={17} aria-hidden="true" /> Your workflow</span>
        <ol>{lesson.topics.map((topic, index) => <li key={topic}><span>0{index + 1}</span>{topic}</li>)}</ol>
      </div>
    </article>
    <p className="pp-tutorials-footer">Keep PodPilot open alongside the guide and follow at your own pace.</p>
  </section>;
}
